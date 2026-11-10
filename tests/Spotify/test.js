// Tests for Scripts/Spotify/spot-proto-ev3.js (built from src/Spotify/proto.js). Run with: node tests/Spotify/test.js
// A free-tier bootstrap/customize response is built here, the script runs through a minimal Loon shim and the
// $done() payload is decoded again.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPT = fs.readFileSync(path.join(ROOT, "Scripts", "Spotify", "spot-proto-ev3.js"), "utf8");
const SNAPSHOT_NEW = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "Spotify", "config", "resolveconfiguration_9_1_76.json"), "utf8"));
const SNAPSHOT_LEGACY = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "Spotify", "config", "resolveconfiguration.json"), "utf8"));

// --- minimal protobuf encoder/decoder -------------------------------------------------------------
function varint(v) {
  const out = [];
  while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
  out.push(v);
  return out;
}
function ld(no, payload) { return Buffer.concat([Buffer.from(varint(no * 8 + 2)), Buffer.from(varint(payload.length)), Buffer.from(payload)]); }
function vi(no, value) { return Buffer.from(varint(no * 8).concat(varint(value))); }
function str(no, s) { return ld(no, Buffer.from(s, "utf8")); }
function msg(...parts) { return Buffer.concat(parts); }

function readVarint(b, p) {
  let v = 0, m = 1;
  for (;;) { const c = b[p++]; v += (c & 0x7f) * m; if (!(c & 0x80)) return [v, p]; m *= 128; }
}
function fields(b) {
  const out = []; let p = 0;
  while (p < b.length) {
    let [key, q] = readVarint(b, p); const no = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) { const [v, r] = readVarint(b, q); out.push({ no, wire, value: v }); p = r; }
    else if (wire === 2) { const [len, r] = readVarint(b, q); out.push({ no, wire, payload: b.subarray(r, r + len) }); p = r + len; }
    else if (wire === 1) { out.push({ no, wire, payload: b.subarray(q, q + 8) }); p = q + 8; }
    else if (wire === 5) { out.push({ no, wire, payload: b.subarray(q, q + 4) }); p = q + 4; }
    else throw new Error("wire " + wire);
  }
  return out;
}
const one = (fs, no) => fs.find((f) => f.no === no);

// --- fixture ----------------------------------------------------------------------------------------
function assigned(scope, name, value) {
  const id = ld(1, msg(str(1, scope), str(2, name)));
  const meta = ld(2, msg(vi(1, 1234), str(2, "exp-planner"), vi(3, 99)));
  let val;
  if (typeof value === "boolean") val = ld(3, value ? vi(1, 1) : Buffer.alloc(0));
  else if (typeof value === "number") val = ld(4, vi(1, value));
  else val = ld(5, str(1, value));
  return ld(3, msg(id, meta, val));
}
function attribute(key, value) {
  let v;
  if (typeof value === "boolean") v = vi(2, value ? 1 : 0);
  else if (typeof value === "number") v = vi(3, value);
  else v = str(4, value);
  return ld(1, msg(str(1, key), ld(2, v)));
}
const configuration = msg(
  str(1, "server-assignment:1"),
  vi(2, 1762000000000),
  assigned("ios-feature-adsbase", "enable_minimal_preroll_management", true),
  assigned("ios-feature-marquee", "is_enabled", true),
  assigned("ios-campfire-properties-impl", "campfire_feature_enabled", true),
  assigned("ios-feature-sidedrawer-platform", "is_list_page_enabled", false),
  assigned("core-offline", "item_state_cache_size", 5000),
  assigned("ios-feature-remoteconfiguration", "button_color_dummy_property", "White"),
  vi(4, 777),
);
const attributes = msg(
  attribute("type", "free"),
  attribute("ads", true),
  attribute("catalogue", "free"),
  attribute("offline", false),
  attribute("audio-quality", "0"),
  attribute("shuffle", true),
  attribute("country", "IT"),
  attribute("max-offline-tracks", 3333),
  attribute("is-premium-eligible-v3", true),
);
const ucs = msg(
  ld(1, ld(1, configuration)),
  ld(3, attributes),
  vi(5, 1762000000001),
  ld(9, Buffer.from("unknown-ucs-field")),
);
const customize = msg(ld(1, ucs), ld(6, Buffer.from("unknown-customize-field")));
const bootstrap = msg(
  ld(2, ld(1, ld(1, customize))),
  ld(3, ld(1, vi(1, 1))),
  ld(7, Buffer.from("unknown-bootstrap-field")),
);

// --- shim -------------------------------------------------------------------------------------------
function run(body, { url = "https://gue1-spclient.spotify.com/bootstrap/v1/bootstrap", method = "POST", status = 200, ua = "Spotify/9.1.98 iOS/26.1 (iPhone16,1)" } = {}) {
  let result;
  const logs = [];
  const sandbox = {
    $request: { url, method, headers: { "User-Agent": ua, Accept: "application/protobuf" } },
    $response: { status, headers: { "content-type": "application/protobuf" }, body: body ? new Uint8Array(body) : body },
    $done: (value) => { result = value; },
    console: { log: (line) => logs.push(line) },
    Uint8Array, ArrayBuffer, Date, Math, Number, String, Object, RegExp, Error,
  };
  vm.runInNewContext(SCRIPT, sandbox, { filename: "spot-proto-ev3.js" });
  assert.ok(result !== undefined, "$done() must always be called");
  return { result, logs };
}
function decodeOutput(result) {
  assert.ok(result.body instanceof Uint8Array || (result.body && result.body.constructor && result.body.constructor.name === "Uint8Array"), "body must be a Uint8Array");
  return Buffer.from(result.body);
}
function readUcs(buf) {
  const resolve = one(fields(buf), 1), attrs = one(fields(buf), 3);
  const conf = fields(one(fields(resolve.payload), 1).payload);
  const values = conf.filter((f) => f.no === 3).map((f) => {
    const parts = fields(f.payload), id = fields(one(parts, 1).payload);
    const v = { scope: one(id, 1).payload.toString(), name: one(id, 2).payload.toString(), hasMetadata: !!one(parts, 2) };
    const b = one(parts, 3), i = one(parts, 4), e = one(parts, 5);
    if (b) v.bool = fields(b.payload).some((x) => x.no === 1 && x.value === 1);
    if (i) { const x = one(fields(i.payload), 1); v.int = x ? x.value : 0; }
    if (e) v.enum = one(fields(e.payload), 1).payload.toString();
    return v;
  });
  const attributes = {};
  for (const f of fields(attrs.payload)) {
    const kv = fields(f.payload), inner = fields(one(kv, 2).payload);
    const key = one(kv, 1).payload.toString();
    const b = one(inner, 2), l = one(inner, 3), s = one(inner, 4);
    attributes[key] = b ? b.value === 1 : l ? l.value : s.payload.toString();
  }
  return {
    assignmentId: one(conf, 1).payload.toString(),
    fetchTime: one(conf, 2).value,
    policy: one(conf, 4).value,
    values,
    attributes,
    ucsFields: fields(buf),
  };
}
const byKey = (values) => Object.fromEntries(values.map((v) => [v.scope + "." + v.name, v]));

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("bootstrap of a 9.1.98 app gets the 9.1.76 snapshot, premium attributes and keeps unknown fields", () => {
  const { result, logs } = run(bootstrap);
  const out = decodeOutput(result);
  const top = fields(out);
  assert.ok(!one(top, 3), "trials facade response must be removed");
  assert.strictEqual(one(top, 7).payload.toString(), "unknown-bootstrap-field", "unknown bootstrap field kept");
  const customizeOut = one(fields(one(fields(one(top, 2).payload), 1).payload), 1).payload;
  assert.strictEqual(one(fields(customizeOut), 6).payload.toString(), "unknown-customize-field", "unknown customize field kept");
  const ucsOut = readUcs(one(fields(customizeOut), 1).payload);
  assert.strictEqual(one(ucsOut.ucsFields, 9).payload.toString(), "unknown-ucs-field", "unknown ucs field kept");
  assert.strictEqual(one(ucsOut.ucsFields, 5).value, 1762000000001, "fetch time kept");
  assert.strictEqual(ucsOut.assignmentId, SNAPSHOT_NEW.configurationAssignmentId);
  assert.strictEqual(String(ucsOut.fetchTime), SNAPSHOT_NEW.fetchTimeMillis);
  assert.strictEqual(String(ucsOut.policy), SNAPSHOT_NEW.policySnapshotId);
  const k = byKey(ucsOut.values);
  assert.strictEqual(k["ios-campfire-properties-impl.campfire_feature_enabled"].bool, true, "live messaging value of the account kept");
  assert.strictEqual(k["ios-feature-sidedrawer-platform.is_list_page_enabled"].bool, false, "live messaging value of the account kept");
  assert.ok(!k["ios-feature-marquee.is_enabled"], "server-only ad scope not carried over");
  assert.ok(!Object.keys(k).some((key) => key.startsWith("ios-feature-adonappopen.")), "ad on app open scope removed");
  assert.ok(!Object.keys(k).some((key) => key.startsWith("ios-feature-instreamads.")), "in-stream ads scope removed");
  assert.strictEqual(k["ios-feature-settings.crossfade_enabled"].bool, true, "forceBool appends or flips");
  assert.strictEqual(k["ios-feature-shuffletoggleupsell.is_enabled_pt2"].bool, false);
  for (const v of ucsOut.values) {
    if (v.bool === true) assert.ok(!/(^|[^a-z0-9])(ad|ads|upsell|sponsored|marquee)([^a-z0-9]|$)/.test(v.scope + "." + v.name) || /^disable_|dismissible|skip_button/.test(v.name), "cohort ad flag left on: " + v.scope + "." + v.name);
  }
  const snapshotKeys = new Set(SNAPSHOT_NEW.assignedValues.map((v) => v.scope + "." + v.name));
  const kept = ucsOut.values.filter((v) => snapshotKeys.has(v.scope + "." + v.name)).length;
  assert.ok(kept > 1000, "most snapshot values present, got " + kept);
  assert.ok(ucsOut.values.every((v) => v.scope && v.name), "every value has an identifier");
  const a = ucsOut.attributes;
  assert.strictEqual(a.type, "premium");
  assert.strictEqual(a.ads, false);
  assert.strictEqual(a.catalogue, "premium");
  assert.strictEqual(a["player-license"], "premium");
  assert.strictEqual(a["high-bitrate"], true);
  assert.strictEqual(a.country, "IT", "untouched attribute kept");
  assert.strictEqual(a.offline, false, "server authoritative attribute restored");
  assert.strictEqual(a["audio-quality"], "0", "server authoritative attribute restored");
  assert.strictEqual(a["max-offline-tracks"], 3333, "server authoritative int64 attribute restored");
  assert.ok(!("shuffle" in a) && !("is-premium-eligible-v3" in a), "stripped attributes gone");
  assert.ok(!("social-session" in a), "missing authoritative attribute is not synthesized");
  assert.match(a["product-expiry"], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(logs.some((l) => /bootstrap app=9\.1\.98 snapshot=9\.1\.76 values=6->\d+ \(live 2/.test(l)), logs.join("\n"));
});

test("an app older than 9.1.76 gets the legacy snapshot", () => {
  const { result, logs } = run(bootstrap, { ua: "Spotify/9.0.48 iOS/18.5 (iPhone14,5)" });
  const out = decodeOutput(result);
  const customizeOut = one(fields(one(fields(one(fields(out), 2).payload), 1).payload), 1).payload;
  const ucsOut = readUcs(one(fields(customizeOut), 1).payload);
  assert.strictEqual(ucsOut.assignmentId, SNAPSHOT_LEGACY.configurationAssignmentId);
  assert.ok(logs.some((l) => /app=9\.0\.48 snapshot=legacy/.test(l)), logs.join("\n"));
});

test("unknown app version defaults to the 9.1.76 snapshot", () => {
  const { result, logs } = run(bootstrap, { ua: "" });
  decodeOutput(result);
  assert.ok(logs.some((l) => /app=unknown snapshot=9\.1\.76/.test(l)), logs.join("\n"));
});

test("customize response is patched the same way", () => {
  const { result, logs } = run(customize, { url: "https://spclient.wg.spotify.com/user-customization-service/v1/customize", ua: "Spotify/9.1.98.620 iOS/26.1" });
  const out = decodeOutput(result);
  assert.strictEqual(one(fields(out), 6).payload.toString(), "unknown-customize-field");
  const ucsOut = readUcs(one(fields(out), 1).payload);
  assert.strictEqual(ucsOut.attributes.type, "premium");
  assert.strictEqual(ucsOut.assignmentId, SNAPSHOT_NEW.configurationAssignmentId);
  assert.ok(logs.some((l) => /customize app=9\.1\.98 snapshot=9\.1\.76/.test(l)), logs.join("\n"));
});

test("remote-config-resolver configuration (app 9.1.98) is replaced by the snapshot", () => {
  const { result, logs } = run(ld(1, configuration), { url: "https://gew4-spclient.spotify.com:443/remote-config-resolver/v3/configuration" });
  const out = decodeOutput(result);
  const top = fields(out);
  assert.strictEqual(top.length, 1, "ResolveResponse wrapper kept");
  const conf = fields(top[0].payload);
  const bare = decodeOutput(run(configuration, { url: "https://gew4-spclient.spotify.com:443/remote-config-resolver/v3/configuration" }).result);
  assert.strictEqual(fields(bare).length, conf.length, "a bare configuration is patched the same way");
  assert.strictEqual(one(conf, 1).payload.toString(), SNAPSHOT_NEW.configurationAssignmentId);
  const values = conf.filter((f) => f.no === 3);
  assert.ok(values.length > 1000, "snapshot values present");
  assert.ok(logs.some((l) => /configuration app=9\.1\.98 snapshot=9\.1\.76 values=6->\d+ \(live 2/.test(l)), logs.join("\n"));
});

test("nebula account attributes (app 9.1.98) are patched, also on GET", () => {
  const { result, logs } = run(attributes, { url: "https://gew4-spclient.spotify.com:443/nebula/v1/configuration/attributes", method: "GET" });
  const out = decodeOutput(result);
  const a = {};
  for (const f of fields(out)) {
    const kv = fields(f.payload), inner = fields(one(kv, 2).payload);
    const b = one(inner, 2), l = one(inner, 3), st = one(inner, 4);
    a[one(kv, 1).payload.toString()] = b ? b.value === 1 : l ? l.value : st.payload.toString();
  }
  assert.strictEqual(a.type, "premium");
  assert.strictEqual(a.ads, false);
  assert.strictEqual(a.offline, false);
  assert.strictEqual(a.country, "IT");
  assert.ok(logs.some((l) => /attributes app=9\.1\.98 .*attributes=\d+ type=free/.test(l)), logs.join("\n"));
});

test("unknown layouts of the new endpoints pass through with a diagnostic line", () => {
  const r1 = run(bootstrap, { url: "https://gew4-spclient.spotify.com:443/remote-config-resolver/v3/configuration" });
  assert.deepStrictEqual(Object.keys(r1.result), []);
  assert.ok(r1.logs.some((l) => /configuration has an unknown layout \[2:2:\d+ 3:2:\d+ 7:2:\d+\]/.test(l)), r1.logs.join("\n"));
  const r2 = run(configuration, { url: "https://gew4-spclient.spotify.com:443/nebula/v1/configuration/attributes", method: "GET" });
  assert.deepStrictEqual(Object.keys(r2.result), []);
  assert.ok(r2.logs.some((l) => /attributes have an unknown layout/.test(l)), r2.logs.join("\n"));
});

test("the output decodes with the same structure when fed back in", () => {
  const first = decodeOutput(run(bootstrap).result);
  const second = decodeOutput(run(first).result);
  assert.strictEqual(first.length, second.length, "idempotent on the size");
});

test("non-200, empty and unexpected responses pass through", () => {
  assert.deepStrictEqual(Object.keys(run(bootstrap, { status: 304 }).result), []);
  assert.deepStrictEqual(Object.keys(run(new Uint8Array(0)).result), []);
  assert.deepStrictEqual(Object.keys(run(bootstrap, { url: "https://spclient.wg.spotify.com/other/v1/thing" }).result), []);
  assert.deepStrictEqual(Object.keys(run(Buffer.from([0x0a, 0xff, 0xff])).result), [], "truncated protobuf passes through");
  assert.deepStrictEqual(Object.keys(run(ld(2, ld(2, str(1, "error")))).result), [], "bootstrap error wrapper passes through");
});

console.log(passed + " tests passed");
