// Tests for Scripts/X/x-adblock.js. Run with: node tests/X/test.js
// The script is executed through a minimal Loon shim; each case checks the $done() payload.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "..", "Scripts", "X", "x-adblock.js"), "utf8");
const FULL = fs.readFileSync(path.join(__dirname, "fixtures", "home_timeline.json"), "utf8");
const ORGANIC = fs.readFileSync(path.join(__dirname, "fixtures", "home_timeline_organic.json"), "utf8");

function runScript(body, argument) {
  let result;
  const logs = [];
  const sandbox = {
    $request: { url: "https://x.com/i/api/graphql/abc/HomeTimeline", method: "POST", headers: {} },
    $response: { status: 200, headers: { "content-type": "application/json" }, body },
    $argument: argument,
    $done: (value) => { result = value; },
    console: { log: (line) => logs.push(line) },
    TextDecoder,
  };
  vm.runInNewContext(SCRIPT, sandbox, { filename: "x-adblock.js" });
  assert.ok(result !== undefined, "$done() must always be called");
  return { result, logs };
}

// $done() payloads come from another vm context: compare by keys, not by prototype.
function assertPassthrough(result) {
  assert.strictEqual(Object.keys(result).length, 0, "expected $done({})");
}

function entries(body) {
  const data = JSON.parse(body);
  const add = data.data.home.home_timeline_urt.instructions.find((i) => i.type === "TimelineAddEntries");
  return add.entries;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

test("default config removes the ads and keeps the rest in order", () => {
  const { result } = runScript(FULL, { remove_promoted: true, remove_ad_carousels: true, remove_who_to_follow: false, remove_message_prompt: false, debug: false });
  assert.ok(result.body, "body must be rewritten");
  const ids = entries(result.body).map((e) => e.entryId);
  assert.deepStrictEqual(ids, [
    "cursor-top-100", "tweet-1", "home-conversation-3", "home-conversation-5",
    "who-to-follow-7", "messageprompt-8", "tweet-9", "cursor-bottom-90",
  ]);
  const module5 = entries(result.body).find((e) => e.entryId === "home-conversation-5");
  assert.deepStrictEqual(module5.content.items.map((i) => i.entryId), ["tweet-51"], "only the promoted item of the module is removed");
  const module3 = entries(result.body).find((e) => e.entryId === "home-conversation-3");
  assert.strictEqual(module3.content.items.length, 2, "organic modules are untouched");
});

test("cursors, TimelineReplaceEntry and TimelinePinEntry survive untouched", () => {
  const { result } = runScript(FULL, {});
  const before = JSON.parse(FULL).data.home.home_timeline_urt.instructions;
  const after = JSON.parse(result.body).data.home.home_timeline_urt.instructions;
  assert.deepStrictEqual(after.filter((i) => i.type !== "TimelineAddEntries"), before.filter((i) => i.type !== "TimelineAddEntries"));
  const cursors = entries(result.body).filter((e) => e.entryId.startsWith("cursor-"));
  assert.deepStrictEqual(cursors, entries(FULL).filter((e) => e.entryId.startsWith("cursor-")));
});

test("optional modules are removed only with their switches on", () => {
  const { result } = runScript(FULL, { remove_who_to_follow: true, remove_message_prompt: true });
  const ids = entries(result.body).map((e) => e.entryId);
  assert.ok(!ids.includes("who-to-follow-7"));
  assert.ok(!ids.includes("messageprompt-8"));
  assert.ok(ids.includes("tweet-1") && ids.includes("tweet-9"));
});

test("promoted entryId is always removed, even with remove_promoted off", () => {
  const { result } = runScript(FULL, { remove_promoted: false, remove_ad_carousels: false });
  const ids = entries(result.body).map((e) => e.entryId);
  assert.ok(!ids.includes("promoted-tweet-2-aa11"));
  assert.ok(ids.includes("tweet-4"), "promotedMetadata rule is off");
  assert.ok(ids.includes("carousel-6"), "carousel rule is off");
  const module5 = entries(result.body).find((e) => e.entryId === "home-conversation-5");
  assert.strictEqual(module5.content.items.length, 2, "module items are untouched when the rule is off");
});

test("string switches from older runtimes are understood", () => {
  const { result } = runScript(FULL, { remove_who_to_follow: "true" });
  assert.ok(!entries(result.body).map((e) => e.entryId).includes("who-to-follow-7"));
});

test("rewritten body is valid JSON and keeps the metadata", () => {
  const { result } = runScript(FULL, {});
  const data = JSON.parse(result.body);
  assert.deepStrictEqual(data.data.home.home_timeline_urt.metadata, { scribeConfig: { page: "home" } });
  assert.deepStrictEqual(data.data.home.home_timeline_urt.responseObjects, { feedbackActions: [] });
});

test("organic timeline passes through without reserialization", () => {
  const { result } = runScript(ORGANIC, {});
  assertPassthrough(result);
});

test("body as bytes is handled", () => {
  const { result } = runScript(new Uint8Array(Buffer.from(FULL, "utf8")), {});
  assert.ok(result.body);
  assert.ok(!entries(result.body).map((e) => e.entryId).includes("promoted-tweet-2-aa11"));
});

test("unparsable body passes through untouched", () => {
  const { result } = runScript(FULL.slice(0, 50), { debug: true });
  assertPassthrough(result);
});

test("missing body passes through untouched", () => {
  const { result } = runScript(undefined, {});
  assertPassthrough(result);
});

test("debug switch logs one summary line", () => {
  const { logs } = runScript(FULL, { debug: true });
  assert.strictEqual(logs.length, 1);
  assert.ok(/^X AdBlock: entries 11, removed 3/.test(logs[0]), logs[0]);
});

console.log(passed + " tests passed");
