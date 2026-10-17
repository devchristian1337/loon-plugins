// YouTube native download, player step (experimental). After the Download button answer has
// been rewritten into the native download command, the app asks the player endpoint for the
// video with the offline flag set (field 8 = 1): for accounts without Premium the server
// answers UNPLAYABLE and the app reports that the video was not downloaded. This script runs
// on that request, drops the offline flag and the empty params so the server answers as for
// ordinary playback, and optionally sends the request as another client:
//   IOS         the app's own client and token: SABR plus HLS manifest, no direct URLs.
//   ANDROID_VR  Oculus client, no token: muxed 360p MP4 plus separate tracks with direct URLs.
//   ANDROID     Android phone client, no token: separate tracks with direct URLs, all qualities.
// Every other player request gets the same ad-related cleanup that request.min.js applies,
// since only one request script runs per request.

var VERSION = "v2";

var CLIENTS = {
  ANDROID_VR: {
    deviceMake: "Oculus", deviceModel: "Quest 3", clientName: 28, clientVersion: "1.65.10",
    osName: "Android", osVersion: "12L", androidSdkVersion: 32,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
  },
  ANDROID: {
    deviceMake: "Google", deviceModel: "Pixel 7", clientName: 3, clientVersion: "20.10.38",
    osName: "Android", osVersion: "13", androidSdkVersion: 33,
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 13; Pixel 7) gzip"
  }
};

// Field numbers observed in the app's own traffic.
var F = {
  context: 1, client: 1, playbackContext: 4, offline: 8, params: 12,
  clientGl: 2, clientDeviceMake: 12, clientDeviceModel: 13, clientName: 16, clientVersion: 17, clientOsName: 18, clientOsVersion: 19, clientSdk: 64,
  contextAdSignals: 9, contentPlayback: 1, playbackAdParams: 12, playbackForceAdParams: 25, playbackInlineNoAd: 50
};

var WIRE_VARINT = 0, WIRE_LEN = 2;

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

function writeVarint(value) {
  var out = [];
  while (value >= 0x80) { out.push((value % 0x80) | 0x80); value = Math.floor(value / 0x80); }
  out.push(value);
  return out;
}

function concat(parts) {
  var total = 0, i;
  for (i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(total), off = 0;
  for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
  return out;
}

// Splits a message into fields; each keeps its raw bytes so untouched fields are copied verbatim.
function parseFields(buf) {
  var fields = [], pos = 0;
  while (pos < buf.length) {
    var start = pos, key = readVarint(buf, pos);
    var no = Math.floor(key.value / 8), wire = key.value % 8;
    if (!no) throw new Error("invalid tag");
    pos = key.pos;
    var field = { no: no, wire: wire };
    if (wire === WIRE_VARINT) { var v = readVarint(buf, pos); field.value = v.value; pos = v.pos; }
    else if (wire === WIRE_LEN) { var l = readVarint(buf, pos); field.data = buf.subarray(l.pos, l.pos + l.value); pos = l.pos + l.value; if (pos > buf.length) throw new Error("truncated field"); }
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new Error("unsupported wire type " + wire);
    field.raw = buf.subarray(start, pos);
    fields.push(field);
  }
  return fields;
}

function encodeVarintField(no, value) { return new Uint8Array(writeVarint(no * 8 + WIRE_VARINT).concat(writeVarint(value))); }
function encodeLenField(no, data) { return concat([new Uint8Array(writeVarint(no * 8 + WIRE_LEN).concat(writeVarint(data.length))), data]); }
function encodeString(s) { var out = [], i; for (i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff); return new Uint8Array(out); }
function build(fields) { return concat(fields.map(function (f) { return f.raw; })); }
function single(fields, no, wire) { var hits = fields.filter(function (f) { return f.no === no; }); return hits.length === 1 && hits[0].wire === wire ? hits[0] : null; }

// Replaces (or appends) one field, keeping the position of the first occurrence.
function setField(fields, no, raw) {
  var out = [], placed = false, i;
  for (i = 0; i < fields.length; i++) {
    if (fields[i].no === no) { if (!placed) { out.push({ no: no, raw: raw }); placed = true; } }
    else out.push(fields[i]);
  }
  if (!placed) out.push({ no: no, raw: raw });
  return out;
}

function dropField(fields, no) { return fields.filter(function (f) { return f.no !== no; }); }

// Rewrites the client message inside the request context into another client identity.
function spoofClient(clientData, c) {
  var cf = parseFields(clientData);
  cf = setField(cf, F.clientDeviceMake, encodeLenField(F.clientDeviceMake, encodeString(c.deviceMake)));
  cf = setField(cf, F.clientDeviceModel, encodeLenField(F.clientDeviceModel, encodeString(c.deviceModel)));
  cf = setField(cf, F.clientName, encodeVarintField(F.clientName, c.clientName));
  cf = setField(cf, F.clientVersion, encodeLenField(F.clientVersion, encodeString(c.clientVersion)));
  cf = setField(cf, F.clientOsName, encodeLenField(F.clientOsName, encodeString(c.osName)));
  cf = setField(cf, F.clientOsVersion, encodeLenField(F.clientOsVersion, encodeString(c.osVersion)));
  cf = setField(cf, F.clientSdk, encodeVarintField(F.clientSdk, c.androidSdkVersion));
  return build(cf);
}

// Offline player request -> ordinary playback request, from the app's own client or the
// selected one. Returns null when the request is not the offline one.
function rewriteOfflinePlayer(body, spoof) {
  var top = parseFields(body);
  var offline = single(top, F.offline, WIRE_VARINT), context = single(top, F.context, WIRE_LEN);
  if (!offline || offline.value !== 1 || !context) return null;
  if (spoof) {
    var ctx = parseFields(context.data), client = single(ctx, F.client, WIRE_LEN);
    if (!client) return null;
    ctx = setField(ctx, F.client, encodeLenField(F.client, spoofClient(client.data, spoof)));
    top = setField(top, F.context, encodeLenField(F.context, build(ctx)));
  }
  top = dropField(top, F.offline);
  var params = single(top, F.params, WIRE_LEN);
  if (params && !params.data.length) top = dropField(top, F.params);
  return build(top);
}

// Mirror of the player cleanup in request.min.js: optional region override on the client,
// ad signals removed from the context, ad parameters removed from the playback context and
// inline playback marked as ad free.
function selectedRegion(region) {
  var r = String(region || "original").toUpperCase();
  return ["CN", "HK", "TW", "US", "JP", "KR", "SG", "GB", "DE", "RU"].indexOf(r) >= 0 ? r : "";
}

function cleanPlayer(body, region) {
  var top = parseFields(body), changed = false;
  var context = single(top, F.context, WIRE_LEN);
  if (context) {
    var ctx = parseFields(context.data), before = ctx.length;
    var client = single(ctx, F.client, WIRE_LEN);
    if (client && region) {
      var cf = parseFields(client.data), gl = single(cf, F.clientGl, WIRE_LEN);
      var current = gl ? String.fromCharCode.apply(null, Array.prototype.slice.call(gl.data)) : "";
      if (current !== region) {
        cf = setField(cf, F.clientGl, encodeLenField(F.clientGl, encodeString(region)));
        ctx = setField(ctx, F.client, encodeLenField(F.client, build(cf)));
        changed = true;
      }
    }
    ctx = dropField(ctx, F.contextAdSignals);
    if (ctx.length !== before || changed) { top = setField(top, F.context, encodeLenField(F.context, build(ctx))); changed = true; }
  }
  var playback = single(top, F.playbackContext, WIRE_LEN);
  if (playback) {
    var pf = parseFields(playback.data), content = single(pf, F.contentPlayback, WIRE_LEN);
    if (content) {
      var cp = parseFields(content.data), size = cp.length;
      cp = dropField(dropField(cp, F.playbackAdParams), F.playbackForceAdParams);
      var inline = single(cp, F.playbackInlineNoAd, WIRE_VARINT);
      if (!inline || inline.value !== 1) cp = setField(cp, F.playbackInlineNoAd, encodeVarintField(F.playbackInlineNoAd, 1));
      if (cp.length !== size || !inline || inline.value !== 1) {
        pf = setField(pf, F.contentPlayback, encodeLenField(F.contentPlayback, build(cp)));
        top = setField(top, F.playbackContext, encodeLenField(F.playbackContext, build(pf)));
        changed = true;
      }
    }
  }
  return changed ? build(top) : null;
}

function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body && body.buffer) return new Uint8Array(body.buffer);
  return null;
}

function selectedClient(name) {
  var n = String(name || "").trim().toUpperCase();
  return CLIENTS[n] ? n : "IOS";
}

// Loon passes argument=[{native_download},{native_download_client},{playback_region}] as an
// object keyed by argument name.
function args() {
  var a = typeof $argument === "undefined" ? null : $argument, out = { enabled: false, client: "IOS", region: "" };
  if (a && typeof a === "object" && !Array.isArray(a)) {
    out.enabled = a.native_download === true || String(a.native_download).trim().toLowerCase() === "true";
    out.client = selectedClient(a.native_download_client);
    out.region = selectedRegion(a.playback_region);
  } else if (Array.isArray(a)) {
    out.enabled = a[0] === true || String(a[0]).trim().toLowerCase() === "true";
    out.client = selectedClient(a[1]);
    out.region = selectedRegion(a[2]);
  } else if (a !== null && a !== undefined) {
    var s = String(a).trim().replace(/^\[|\]$/g, "").split(",");
    var first = s[0].trim().toLowerCase();
    if (first.indexOf("=") >= 0) first = first.split("=")[1].trim();
    out.enabled = first === "true" || first === "1";
    out.client = selectedClient(s[1] ? s[1].trim() : "");
    out.region = selectedRegion(s[2] ? s[2].trim() : "");
  }
  return out;
}

// Removes the app's OAuth token (valid for the iOS client only) and sets the user agent of
// the selected client, keeping every other header.
function spoofHeaders(headers, c) {
  var out = {}, keys = Object.keys(headers || {}), i;
  for (i = 0; i < keys.length; i++) {
    var k = keys[i].toLowerCase();
    if (k === "authorization" || k === "user-agent" || k === "content-length") continue;
    out[keys[i]] = headers[keys[i]];
  }
  out["User-Agent"] = c.userAgent;
  return out;
}

try {
  var options = args();
  var body = toBytes($request.body);
  if (!options.enabled || !body || !body.length) {
    $done({});
  } else {
    var spoof = CLIENTS[options.client] || null;
    var rewritten = rewriteOfflinePlayer(body, spoof);
    if (rewritten) {
      console.log("YouTube download player " + VERSION + ": offline player request sent as " + options.client + " playback");
      if (spoof) $done({ headers: spoofHeaders($request.headers, spoof), body: rewritten });
      else $done({ body: rewritten });
    } else {
      var cleaned = cleanPlayer(body, options.region);
      if (cleaned) $done({ body: cleaned });
      else $done({});
    }
  }
} catch (e) {
  console.log("YouTube download player: left unchanged (" + e + ")");
  $done({});
}
