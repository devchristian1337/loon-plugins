// YouTube download link (experimental). Runs on the request the app sends when the Download
// button is tapped (offline/get_download_action). It reads the video id from that request,
// asks the YouTube player API for the same video with alternative clients that may still
// return direct media URLs, reusing the app's own authorization and visitor headers, and
// posts a Loon notification: tapping it opens the best direct URL found in Safari, where
// the file can be saved. Progressive MP4 formats are preferred (720p, then 360p); when only
// an audio track has a URL, that is offered. The request itself is passed through unchanged.
// When no client returns a usable URL, the notification reports what each client answered.

var CLIENTS = [
  { name: "ANDROID_VR", version: "1.62.27", ua: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip", extra: { androidSdkVersion: 32 } },
  { name: "TVHTML5", version: "7.20250312.16.00", ua: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version", extra: {} },
  { name: "IOS", version: "20.40.1", ua: "com.google.ios.youtube/20.40.1 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X;)", extra: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.6" } },
  { name: "MWEB", version: "2.20250312.00.00", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", extra: {} }
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

// Picks the best downloadable format: progressive MP4 by height, else an audio track.
function pickFormat(streamingData) {
  var formats = (streamingData && streamingData.formats) || [];
  var best = null, i;
  for (i = 0; i < formats.length; i++) {
    var f = formats[i];
    if (!f.url || !/mp4/.test(f.mimeType || "")) continue;
    if (!best || (f.height || 0) > (best.height || 0)) best = f;
  }
  if (best) return { url: best.url, label: (best.qualityLabel || (best.height + "p")) + " MP4" };
  var adaptive = (streamingData && streamingData.adaptiveFormats) || [];
  for (i = 0; i < adaptive.length; i++) {
    var a = adaptive[i];
    if (a.url && /^audio\/mp4/.test(a.mimeType || "")) return { url: a.url, label: "audio M4A" + (a.bitrate ? " " + Math.round(a.bitrate / 1000) + " kbps" : "") };
  }
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

function probe(videoId, baseHeaders, index, report, finish) {
  if (index >= CLIENTS.length) return finish(null, report);
  var c = CLIENTS[index];
  var client = { clientName: c.name, clientVersion: c.version, hl: "it", gl: "IT" };
  var keys = Object.keys(c.extra), i;
  for (i = 0; i < keys.length; i++) client[keys[i]] = c.extra[keys[i]];
  var headers = { "Content-Type": "application/json", "User-Agent": c.ua, "Accept-Language": "it-IT,it;q=0.9" };
  var auth = header(baseHeaders, "authorization"), visitor = header(baseHeaders, "x-goog-visitor-id");
  if (auth) headers["Authorization"] = auth;
  if (visitor) headers["X-Goog-Visitor-Id"] = visitor;
  $httpClient.post({
    url: "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
    headers: headers,
    timeout: 8,
    body: JSON.stringify({ context: { client: client }, videoId: videoId, contentCheckOk: true, racyCheckOk: true })
  }, function (error, response, data) {
    if (error) { report.push(c.name + ": errore rete"); return probe(videoId, baseHeaders, index + 1, report, finish); }
    var json = null;
    try { json = JSON.parse(typeof data === "string" ? data : String(data)); } catch (e) { json = null; }
    if (!json) { report.push(c.name + ": risposta non JSON (" + (response && response.status) + ")"); return probe(videoId, baseHeaders, index + 1, report, finish); }
    var ps = json.playabilityStatus || {};
    var pick = ps.status === "OK" ? pickFormat(json.streamingData) : null;
    if (pick) return finish({ client: c.name, url: pick.url, label: pick.label }, report);
    report.push(describe(c.name, ps.status, ps.reason, json.streamingData));
    probe(videoId, baseHeaders, index + 1, report, finish);
  });
}

try {
  var body = $request.body instanceof Uint8Array ? $request.body : ($request.body && $request.body.buffer ? new Uint8Array($request.body.buffer) : null);
  var videoId = enabled() ? videoIdFromRequest(body) : null;
  if (!videoId) {
    $done({});
  } else {
    probe(videoId, $request.headers || {}, 0, [], function (found, report) {
      try {
        if (found) {
          $notification.post("YouTube download", found.label + " via " + found.client, "Tocca per aprire il file in Safari e salvarlo", { openUrl: found.url, "open-url": found.url });
          console.log("YouTube download link: " + found.label + " via " + found.client);
        } else {
          $notification.post("YouTube download", "Nessun URL diretto per " + videoId, report.join(" | "));
          console.log("YouTube download link: none. " + report.join(" | "));
        }
      } catch (e) { console.log("YouTube download link: notification failed (" + e + ")"); }
      $done({});
    });
  }
} catch (e) {
  console.log("YouTube download link: left unchanged (" + e + ")");
  $done({});
}
