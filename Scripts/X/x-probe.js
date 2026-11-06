// Research probe for the X (Twitter) iOS app. It never modifies the response: it only
// inspects the Home timeline GraphQL answers (HomeTimeline, HomeLatestTimeline) and reports
// what it finds in the Loon script log and in a compact notification, so that the ad markers
// can be verified on real traffic before any ad removal is written.
// Reported per response: host and path (query string replaced by "?…"), operationName and
// queryId taken from the path, content-type, content-encoding, HTTP version when the runtime
// exposes it, the size of every "entries" array, how many entries each candidate rule matches
// (entryId starting with "promoted", promotedMetadata in itemContent, promotedMetadata in the
// items of a module, module displayType "Carousel"), a sketch of the first two candidates, the
// histogram of entryId prefixes and entry types, and the outcome of JSON.parse.
// Always ends with $done({}), also on unexpected input.

var TAG = "X probe";
var MAX_SAMPLES = 2;

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    return fallback;
  }
}

function header(headers, name) {
  if (!headers) return "";
  var lower = name.toLowerCase();
  for (var key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) {
      return String(headers[key]);
    }
  }
  return "";
}

function describeUrl(url) {
  var m = /^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/.exec(String(url || ""));
  var host = m ? m[1] : "";
  var path = m ? m[2] : "";
  var op = /\/graphql\/([^/]+)\/([^/?#]+)/.exec(path);
  return {
    host: host,
    path: path + (m && m[3] ? "?…" : ""),
    queryId: op ? op[1] : "",
    operationName: op ? op[2] : "",
  };
}

function bodyToString(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(body);
  var s = "";
  for (var i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
  return decodeURIComponent(escape(s));
}

// Collects every array stored under an "entries" key, at any depth.
function collectEntryArrays(node, out, depth) {
  if (!node || typeof node !== "object" || depth > 12) return out;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) collectEntryArrays(node[i], out, depth + 1);
    return out;
  }
  for (var key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    var value = node[key];
    if (key === "entries" && Array.isArray(value)) out.push(value);
    collectEntryArrays(value, out, depth + 1);
  }
  return out;
}

function countKey(node, wanted, depth) {
  if (!node || typeof node !== "object" || depth > 12) return 0;
  var n = 0;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) n += countKey(node[i], wanted, depth + 1);
    return n;
  }
  for (var key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    if (key === wanted) n++;
    n += countKey(node[key], wanted, depth + 1);
  }
  return n;
}

function bump(map, key) {
  key = key || "(none)";
  map[key] = (map[key] || 0) + 1;
}

function formatMap(map) {
  var keys = Object.keys(map).sort(function (a, b) {
    return map[b] - map[a];
  });
  return keys
    .map(function (k) {
      return k + "=" + map[k];
    })
    .join(" ");
}

function analyze(entries) {
  var report = {
    total: 0,
    promotedId: 0,
    promotedItemContent: 0,
    promotedModuleEntries: 0,
    promotedModuleItems: 0,
    carousel: 0,
    cursors: 0,
    prefixes: {},
    entryTypes: {},
    itemTypes: {},
    samples: [],
  };
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i] || {};
    var entryId = String(entry.entryId || "");
    var content = entry.content || {};
    var itemContent = content.itemContent || {};
    var items = Array.isArray(content.items) ? content.items : [];
    report.total++;
    bump(report.prefixes, entryId.split("-")[0]);
    bump(report.entryTypes, content.entryType || content.__typename);
    if (itemContent.itemType || itemContent.__typename) {
      bump(report.itemTypes, itemContent.itemType || itemContent.__typename);
    }
    if (/^cursor-/i.test(entryId)) report.cursors++;

    var r1 = /^promoted/i.test(entryId);
    var r2 = Object.prototype.hasOwnProperty.call(itemContent, "promotedMetadata");
    var promotedItems = 0;
    for (var j = 0; j < items.length; j++) {
      var inner = items[j] && items[j].item && items[j].item.itemContent;
      if (inner && Object.prototype.hasOwnProperty.call(inner, "promotedMetadata")) promotedItems++;
    }
    var r3 = promotedItems > 0;
    var r4 = content.displayType === "Carousel";
    if (r1) report.promotedId++;
    if (r2) report.promotedItemContent++;
    if (r3) {
      report.promotedModuleEntries++;
      report.promotedModuleItems += promotedItems;
    }
    if (r4) report.carousel++;

    if ((r1 || r2 || r3 || r4) && report.samples.length < MAX_SAMPLES) {
      report.samples.push(
        [
          "entryId=" + (entryId || "(none)"),
          "entryType=" + (content.entryType || content.__typename || "(none)"),
          "displayType=" + (content.displayType || "(none)"),
          "promotedMetadata=" + (r2 || r3 ? "yes" : "no"),
          "rules=" + ["R1", "R2", "R3", "R4"].filter(function (_, k) {
            return [r1, r2, r3, r4][k];
          }).join("+"),
          "length=" + safe(function () {
            return JSON.stringify(entry).length;
          }, -1),
        ].join(" ")
      );
    }
  }
  return report;
}

function run() {
  var request = typeof $request !== "undefined" ? $request : {};
  var response = typeof $response !== "undefined" ? $response : {};
  var where = describeUrl(request.url);
  var lines = [];
  lines.push("url: " + where.host + where.path);
  lines.push("operation: " + (where.operationName || "(none)") + " queryId: " + (where.queryId || "(none)"));
  lines.push(
    "status: " +
      (response.status != null ? response.status : "(none)") +
      " content-type: " +
      (header(response.headers, "Content-Type") || "(none)") +
      " content-encoding: " +
      (header(response.headers, "Content-Encoding") || "(none)") +
      " http: " +
      (response.httpVersion || request.httpVersion || "(not exposed)")
  );

  var text = safe(function () {
    return bodyToString(response.body);
  }, null);
  var summary;
  if (text == null) {
    lines.push("body: absent (requires-body missing or empty response)");
    summary = "no body";
  } else {
    lines.push("body: " + text.length + " chars");
    var parsed = null;
    var parseError = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parseError = e;
    }
    if (parseError) {
      lines.push("JSON.parse: FAILED (" + parseError + ") head: " + JSON.stringify(text.slice(0, 80)));
      summary = "JSON.parse failed";
    } else {
      lines.push("JSON.parse: ok");
      var arrays = collectEntryArrays(parsed, [], 0);
      lines.push("entries arrays: " + arrays.length + " sizes: " + (arrays.map(function (a) { return a.length; }).join(",") || "(none)"));
      var all = [];
      for (var i = 0; i < arrays.length; i++) all = all.concat(arrays[i]);
      var r = analyze(all);
      lines.push(
        "candidates: R1 promotedId=" + r.promotedId +
          " R2 itemContent.promotedMetadata=" + r.promotedItemContent +
          " R3 module items promotedMetadata=" + r.promotedModuleEntries + " (" + r.promotedModuleItems + " items)" +
          " R4 Carousel=" + r.carousel +
          " cursors=" + r.cursors +
          " promotedMetadata keys anywhere=" + countKey(parsed, "promotedMetadata", 0)
      );
      lines.push("entryId prefixes: " + (formatMap(r.prefixes) || "(none)"));
      lines.push("entryTypes: " + (formatMap(r.entryTypes) || "(none)"));
      lines.push("itemTypes: " + (formatMap(r.itemTypes) || "(none)"));
      for (var s = 0; s < r.samples.length; s++) lines.push("sample " + (s + 1) + ": " + r.samples[s]);
      summary =
        "entries " + r.total + " | R1 " + r.promotedId + " R2 " + r.promotedItemContent +
        " R3 " + r.promotedModuleEntries + " R4 " + r.carousel + " | cursors " + r.cursors;
    }
  }

  var log = TAG + " | " + lines.join("\n" + TAG + " | ");
  console.log(log);
  if (typeof $notification !== "undefined" && $notification && typeof $notification.post === "function") {
    $notification.post(TAG, where.operationName || where.path, summary + "\n" + lines.slice(0, 6).join("\n"));
  }
}

try {
  run();
} catch (e) {
  console.log(TAG + " | unexpected error, response left unchanged (" + e + ")");
}
$done({});
