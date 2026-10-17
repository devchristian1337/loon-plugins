// YouTube download link (experimental). Runs on the request the app sends when the Download
// button is tapped (offline/get_download_action). It reads the video id from that request,
// asks the YouTube player API for the same video with alternative clients that may still
// return direct media URLs, reusing the app's own authorization and visitor headers, and
// posts a Loon notification: tapping it opens the best direct URL found in Safari, where
// the file can be saved. Progressive MP4 formats are preferred (720p, then 360p); when only
// an audio track has a URL, that is offered. The request itself is passed through unchanged.
// When no client returns a usable URL, the notification reports what each client answered.

// Shown in the notifications so the running script version can be told from a cached one.
var VERSION = "v6";

// Per-request timeout in milliseconds (Loon reads $httpClient timeouts in ms). Kept short so the
// whole probe (4 clients, one retry each, plus the control request) stays within the rule timeout.
var REQUEST_TIMEOUT = 4000, CONTROL_TIMEOUT = 3000;

var CLIENTS = [
  // Oculus client: the only one still answering with muxed (video+audio) MP4 formats. It is sent
  // without the app's OAuth token, which belongs to the iOS client and makes the request invalid.
  { name: "ANDROID_VR", version: "1.65.10", ua: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip", extra: { deviceMake: "Oculus", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32 }, auth: false },
  // The app's own client, with its token: answers with separate video and audio tracks (no muxed file).
  { name: "IOS", version: "20.40.1", ua: "com.google.ios.youtube/20.40.1 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X;)", extra: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.6" }, auth: true },
  { name: "TVHTML5", version: "7.20250312.16.00", ua: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version", extra: {}, auth: true },
  { name: "MWEB", version: "2.20250312.00.00", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", extra: {}, auth: true }
];

function readVarint(buf, pos) {
  var value = 0, shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error("truncated varint");
    var byte = buf[pos++];
    value += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) return { value: value, pos: pos };
    shift += 7;
  }
}

// Returns the video id carried by the download action request (top-level field 8).
function videoIdFromRequest(body) {
  if (!body || !body.length) return null;
  var pos = 0;
  while (pos < body.length) {
    var key = readVarint(body, pos), no = Math.floor(key.value / 8), wire = key.value % 8;
    pos = key.pos;
    if (wire === 0) pos = readVarint(body, pos).pos;
    else if (wire === 2) {
      var len = readVarint(body, pos);
      var data = body.subarray(len.pos, len.pos + len.value);
      pos = len.pos + len.value;
      if (no === 8) {
        var s = "", i;
        for (i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
        return /^[\w-]{11}$/.test(s) ? s : null;
      }
    }
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else return null;
  }
  return null;
}

function header(headers, name) {
  var keys = Object.keys(headers || {}), i;
  for (i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return headers[keys[i]];
  return null;
}

function enabled() {
  var a = typeof $argument === "undefined" ? null : $argument;
  if (a && typeof a === "object" && !Array.isArray(a)) a = "native_download" in a ? a.native_download : a[Object.keys(a)[0]];
  else if (Array.isArray(a)) a = a[0];
  if (a === true) return true;
  var s = String(a === null || a === undefined ? "" : a).trim().toLowerCase().replace(/^\[|\]$/g, "").split(",")[0].trim();
  if (s.indexOf("=") >= 0) s = s.split("=")[1].trim();
  return s === "true" || s === "1";
}

// First separate track with a URL (the kind the app's downloader asks for), for the probes.
function firstAdaptiveUrl(adaptive) {
  var i;
  for (i = 0; i < adaptive.length; i++) if (adaptive[i].url) return adaptive[i].url;
  return null;
}

// Picks the best downloadable format: progressive MP4 by height, else an audio track.
function pickFormat(streamingData) {
  var formats = (streamingData && streamingData.formats) || [];
  var best = null, i;
  for (i = 0; i < formats.length; i++) {
    var f = formats[i];
    if (!f.url || !/mp4/.test(f.mimeType || "")) continue;
    if (!best || (f.height || 0) > (best.height || 0)) best = f;
  }
  var adaptive = (streamingData && streamingData.adaptiveFormats) || [], audio = null;
  if (best) return { url: best.url, label: (best.qualityLabel || (best.height + "p")) + " MP4", alt: firstAdaptiveUrl(adaptive) };
  for (i = 0; i < adaptive.length; i++) {
    var a = adaptive[i];
    if (!a.url || !/^audio\/mp4/.test(a.mimeType || "")) continue;
    if (!audio || (a.bitrate || 0) > (audio.bitrate || 0)) audio = a;
  }
  if (audio) return { url: audio.url, label: "audio M4A" + (audio.bitrate ? " " + Math.round(audio.bitrate / 1000) + " kbps" : "") };
  return null;
}

function describe(client, status, reason, streamingData) {
  var sd = streamingData || {};
  var detail = status || "?";
  if (reason) detail += " " + String(reason).slice(0, 40);
  if (sd.serverAbrStreamingUrl && !(sd.formats || []).length) detail += " (SABR)";
  else if ((sd.formats || []).length || (sd.adaptiveFormats || []).length) detail += " (" + (sd.formats || []).length + "+" + (sd.adaptiveFormats || []).length + " formati, senza URL)";
  return client + ": " + detail;
}

function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  try { return error.message || JSON.stringify(error); } catch (e) { return String(error); }
}

// Sends a request; when it fails, retries once forcing the direct outbound (node DIRECT), in
// case the failure comes from the policy the profile applies to script traffic.
function send(method, options, callback) {
  $httpClient[method](options, function (error, response, data) {
    if (!error || options.node) return callback(error, response, data, options.node ? "DIRECT" : "");
    var retry = {}, keys = Object.keys(options), i;
    for (i = 0; i < keys.length; i++) retry[keys[i]] = options[keys[i]];
    retry.node = "DIRECT";
    $httpClient[method](retry, function (error2, response2, data2) {
      callback(error2, response2, data2, error2 ? "" : "DIRECT");
    });
  });
}

// Control request to a host outside the MITM list, to tell a general network failure of the
// script runtime from a failure specific to the YouTube host.
function control(report, errors, finish) {
  send("get", { url: "https://www.gstatic.com/generate_204", timeout: CONTROL_TIMEOUT }, function (error, response, data, via) {
    if (error) errors.push("gstatic: " + errorText(error));
    report.push("controllo gstatic: " + (error ? "errore" : "ok " + (response && response.status) + (via ? " via " + via : "")));
    finish(null, report, errors);
  });
}

function probe(videoId, baseHeaders, index, report, errors, finish) {
  if (index >= CLIENTS.length) return control(report, errors, finish);
  var c = CLIENTS[index];
  var client = { clientName: c.name, clientVersion: c.version, hl: "it", gl: "IT" };
  var keys = Object.keys(c.extra), i;
  for (i = 0; i < keys.length; i++) client[keys[i]] = c.extra[keys[i]];
  var headers = { "Content-Type": "application/json", "User-Agent": c.ua, "Accept-Language": "it-IT,it;q=0.9" };
  var auth = c.auth ? header(baseHeaders, "authorization") : null, visitor = header(baseHeaders, "x-goog-visitor-id");
  if (auth) headers["Authorization"] = auth;
  if (visitor) headers["X-Goog-Visitor-Id"] = visitor;
  send("post", {
    url: "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
    headers: headers,
    timeout: REQUEST_TIMEOUT,
    body: JSON.stringify({ context: { client: client }, videoId: videoId, contentCheckOk: true, racyCheckOk: true })
  }, function (error, response, data, via) {
    if (error) { errors.push(c.name + ": " + errorText(error)); report.push(c.name + ": errore rete"); return probe(videoId, baseHeaders, index + 1, report, errors, finish); }
    if (via) report.push(c.name + " raggiunto via " + via);
    var json = null;
    try { json = JSON.parse(typeof data === "string" ? data : String(data)); } catch (e) { json = null; }
    if (!json) { report.push(c.name + ": risposta non JSON (" + (response && response.status) + ")"); return probe(videoId, baseHeaders, index + 1, report, errors, finish); }
    var ps = json.playabilityStatus || {};
    var pick = ps.status === "OK" ? pickFormat(json.streamingData) : null;
    if (pick) return finish({ client: c.name, url: pick.url, label: pick.label, alt: pick.alt || null }, report, errors);
    report.push(describe(c.name, ps.status, ps.reason, json.streamingData));
    probe(videoId, baseHeaders, index + 1, report, errors, finish);
  });
}

// Probes the found URL from the device itself, with three request shapes, and reports the
// status of each: tells whether the media servers accept the URL at all and which shape.
var VR_UA = "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
var PROBES = [
  { name: "UA Oculus+Range", headers: function () { return { "User-Agent": VR_UA, "Range": "bytes=0-1023" }; }, suffix: "" },
  { name: "UA app", headers: function () { return { "User-Agent": "YouTube/21.41.5 CFNetwork/3896.100.1.2.1 Darwin/27.0.0" }; }, suffix: "" },
  { name: "range param", headers: function () { return { "User-Agent": VR_UA }; }, suffix: "&range=0-1023" }
];

function probeUrl(found, index, results, finish) {
  // The three shapes on the chosen (muxed) URL, then the first shape on a separate track.
  var p = index < PROBES.length ? PROBES[index] : (index === PROBES.length && found.alt ? PROBES[0] : null);
  if (!p) return finish(results);
  var url = (index < PROBES.length ? found.url : found.alt) + p.suffix;
  $httpClient.get({ url: url, headers: p.headers(), timeout: REQUEST_TIMEOUT, "binary-mode": true, "auto-redirect": true }, function (error, response, data) {
    var size = data ? (data.length || data.byteLength || 0) : 0;
    results.push((index < PROBES.length ? p.name : "traccia separata") + ": " + (error ? "errore " + errorText(error).slice(0, 40) : (response && response.status) + " " + size + "B"));
    probeUrl(found, index + 1, results, finish);
  });
}

function remember(text) {
  try { if (typeof $persistentStore !== "undefined") $persistentStore.write(text, "youtube.download.link.last"); } catch (e) {}
}

try {
  var body = $request.body instanceof Uint8Array ? $request.body : ($request.body && $request.body.buffer ? new Uint8Array($request.body.buffer) : null);
  var videoId = enabled() ? videoIdFromRequest(body) : null;
  if (!videoId) {
    $done({});
  } else {
    probe(videoId, $request.headers || {}, 0, [], [], function (found, report, errors) {
      try {
        if (found) {
          probeUrl(found, 0, [], function (results) {
            $notification.post("YouTube download " + VERSION, found.label + " via " + found.client + " | " + results.join(" | "), "Tocca per aprire il file in Safari e salvarlo", { openUrl: found.url, "open-url": found.url });
            console.log("YouTube download link: " + found.label + " via " + found.client + " | " + results.join(" | "));
            remember("OK " + found.label + " via " + found.client + " | " + results.join(" | ") + " | " + report.join(" | "));
            $done({});
          });
          return;
        } else {
          $notification.post("YouTube download " + VERSION, "Nessun URL diretto per " + videoId, report.join(" | "));
          // The first error in full, in its own notification, so nothing is lost to truncation.
          if (errors.length) $notification.post("YouTube download " + VERSION + ": errore", errors[0].split(": ")[0], errors[0].slice(errors[0].indexOf(": ") + 2, 600));
          console.log("YouTube download link: none. " + report.join(" | ") + " || " + errors.join(" || "));
          remember("NONE " + report.join(" | ") + " || " + errors.join(" || "));
        }
      } catch (e) { console.log("YouTube download link: notification failed (" + e + ")"); }
      $done({});
    });
  }
} catch (e) {
  console.log("YouTube download link: left unchanged (" + e + ")");
  $done({});
}
