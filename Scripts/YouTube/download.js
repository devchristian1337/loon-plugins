// YouTube native download unlock (experimental). Two rewrites on youtubei.googleapis.com:
//   response offline/get_download_action: when the server answers the Download button with
//     the paywall ("gated download"), the message is rewritten into the native ACTION_ADD
//     command that the app receives for entitled accounts (720p unless the gate names a
//     format), keeping the response's own tracking data.
//   request player: an offline player request (field 8 = 1) carrying an empty params field
//     (12) gets that empty field removed, to match the native offline request.
// The media itself is still served by YouTube, so the download may fail or stay pending
// when the server refuses. Anything unexpected is passed through unchanged.

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
function ascii(data) { var s = "", i; for (i = 0; i < data.length; i++) { if (data[i] < 32 || data[i] > 126) return null; s += String.fromCharCode(data[i]); } return s; }
function single(fields, no, wire) { var hits = fields.filter(function (f) { return f.no === no; }); return hits.length === 1 && hits[0].wire === wire ? hits[0] : null; }

function base64Decode(s) {
  var table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = [], bits = 0, acc = 0, i;
  s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  for (i = 0; i < s.length; i++) {
    var v = table.indexOf(s.charAt(i));
    if (v < 0) throw new Error("bad base64");
    acc = acc * 64 + v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push(Math.floor(acc / Math.pow(2, bits)) & 0xff); acc = acc % Math.pow(2, bits); }
  }
  return new Uint8Array(out);
}

// Field numbers observed in the app's own traffic.
var F = {
  command: 2,            // DownloadAction.command
  tracking: 2,           // DownloadCommand.tracking (bytes)
  gatedDownload: 382320942,
  executor: 174116574,
  offlineVideo: 73080600,
  gateVideoId: 1, gateFormatType: 3, gateParams: 5,
  executorCommands: 1,
  ovVideoId: 1, ovAction: 2, ovOfflineability: 4, ovActionParams: 6,
  offlineabilityRenderer: 60572968,
  rendererOfflineable: 1, rendererTracking: 4,
  trackingIndex: 1, trackingVisualElement: 2,
  paramsFormatType: 1, paramsSettingsAction: 2,
  playerOffline: 8, playerParams: 12
};

function rewriteDownloadAction(body) {
  var top = parseFields(body);
  var command = single(top, F.command, WIRE_LEN);
  if (!command) return null;
  var cf = parseFields(command.data);
  var gate = single(cf, F.gatedDownload, WIRE_LEN);
  if (!gate || cf.some(function (f) { return f.no === F.executor || f.no === F.offlineVideo; })) return null;
  var gf = parseFields(gate.data);
  var videoId = single(gf, F.gateVideoId, WIRE_LEN), params = single(gf, F.gateParams, WIRE_LEN), formatType = single(gf, F.gateFormatType, WIRE_VARINT);
  var id = videoId && ascii(videoId.data);
  if (!id || !/^[\w-]{11}$/.test(id) || !params || !params.data.length) return null;
  // Only the upsell path: the gate params carry field 4 = 1.
  var decoded = parseFields(base64Decode(decodeURIComponent(ascii(params.data) || "")));
  if (!decoded.some(function (f) { return f.no === 4 && f.wire === WIRE_VARINT && f.value === 1; })) return null;

  var tracking = single(cf, F.tracking, WIRE_LEN);
  var rendererParts = [encodeVarintField(F.rendererOfflineable, 1)];
  if (tracking && tracking.data.length) {
    var tf = parseFields(tracking.data).filter(function (f) { return f.no !== F.trackingIndex && f.no !== F.trackingVisualElement; }).map(function (f) { return f.raw; });
    rendererParts.push(encodeLenField(F.rendererTracking, concat([encodeVarintField(F.trackingIndex, 1), encodeVarintField(F.trackingVisualElement, 7111)].concat(tf))));
  }
  var offlineVideo = concat([
    encodeLenField(F.ovVideoId, encodeString(id)),
    encodeVarintField(F.ovAction, 1),
    encodeLenField(F.ovOfflineability, encodeLenField(F.offlineabilityRenderer, concat(rendererParts))),
    encodeLenField(F.ovActionParams, concat([
      encodeVarintField(F.paramsFormatType, formatType ? formatType.value : 2),
      encodeVarintField(F.paramsSettingsAction, 4)
    ]))
  ]);
  var inner = concat((tracking ? [tracking.raw] : []).concat([encodeLenField(F.offlineVideo, offlineVideo)]));
  var executor = encodeLenField(F.executor, encodeLenField(F.executorCommands, inner));
  var newCommand = concat(cf.filter(function (f) { return f !== gate; }).map(function (f) { return f.raw; }).concat([executor]));
  return concat(top.map(function (f) { return f === command ? encodeLenField(F.command, newCommand) : f.raw; }));
}

function rewritePlayerRequest(body) {
  var fields = parseFields(body);
  var offline = single(fields, F.playerOffline, WIRE_VARINT), params = single(fields, F.playerParams, WIRE_LEN);
  if (!offline || offline.value !== 1 || !params || params.data.length !== 0) return null;
  return concat(fields.filter(function (f) { return f !== params; }).map(function (f) { return f.raw; }));
}

function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body && body.buffer) return new Uint8Array(body.buffer);
  return null;
}

function enabled() {
  var a = typeof $argument === "undefined" ? null : $argument;
  if (Array.isArray(a)) a = a[0];
  return a === true || String(a).toLowerCase() === "true";
}

try {
  var url = String($request.url || "");
  var out = null;
  if (!enabled()) {
    $done({});
  } else if (typeof $response !== "undefined" && $response) {
    var rb = toBytes($response.body);
    if (rb && /\/youtubei\/v1\/offline\/get_download_action/.test(url)) out = rewriteDownloadAction(rb);
    if (out) { console.log("YouTube download: gated download rewritten to native ACTION_ADD"); $done({ body: out }); }
    else { console.log("YouTube download: response left unchanged"); $done({}); }
  } else {
    var qb = toBytes($request.body);
    if (qb && /\/youtubei\/v1\/player(?:\?|$)/.test(url)) out = rewritePlayerRequest(qb);
    if (out) { console.log("YouTube download: empty params removed from offline player request"); $done({ body: out }); }
    else $done({});
  }
} catch (e) {
  console.log("YouTube download: left unchanged (" + e + ")");
  $done({});
}
