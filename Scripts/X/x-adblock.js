// Removes the ads from the Home timeline of the X (Twitter) web app (x.com in Safari or as
// a Home Screen web app) by filtering the "entries" arrays of the HomeTimeline and
// HomeLatestTimeline GraphQL responses. Verified on real traffic: every promoted post is a
// TimelineTimelineItem whose entryId starts with "promoted-tweet-" and whose itemContent
// carries a promotedMetadata object; the other rules cover the ad formats X uses elsewhere.
// Cursors (cursor-top-*, cursor-bottom-*) and the TimelineReplaceEntry / TimelinePinEntry
// instructions are never touched, so paging keeps working. When nothing is removed the
// response is passed through untouched; any unexpected input is passed through as well.
// The native X app pins its certificates and never reaches this script.

var CONFIG = {
  removePromotedTweets: true, // promotedMetadata in itemContent or in the items of a module
  removeAdCarousels: true, // modules with displayType "Carousel"
  removeWhoToFollow: false, // "Who to follow" modules
  removeMessagePrompt: false, // message prompts and inbox modules
  debug: false, // one log line per response
};

var TAG = "X AdBlock";

// Loon passes the plugin switches as an object keyed by argument name; older runtimes pass a
// string. Anything unreadable keeps the defaults above.
function applyArguments(config) {
  var raw = typeof $argument !== "undefined" ? $argument : null;
  if (!raw) return config;
  var args = raw;
  if (typeof raw === "string") {
    try {
      args = JSON.parse(raw);
    } catch (e) {
      return config;
    }
  }
  if (!args || typeof args !== "object") return config;
  var map = {
    remove_promoted: "removePromotedTweets",
    remove_ad_carousels: "removeAdCarousels",
    remove_who_to_follow: "removeWhoToFollow",
    remove_message_prompt: "removeMessagePrompt",
    debug: "debug",
  };
  for (var key in map) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
    var value = args[key];
    if (value === true || value === "true") config[map[key]] = true;
    else if (value === false || value === "false") config[map[key]] = false;
  }
  return config;
}

function bodyToString(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(body);
  var s = "";
  for (var i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
  return decodeURIComponent(escape(s));
}

function hasPromotedMetadata(itemContent) {
  return !!itemContent && typeof itemContent === "object" &&
    Object.prototype.hasOwnProperty.call(itemContent, "promotedMetadata");
}

// Decides what to do with one timeline entry. Returns "keep", "drop" or "filtered" (a
// module whose promoted items were removed).
function processEntry(entry, config, stats) {
  if (!entry || typeof entry !== "object") return "keep";
  var id = String(entry.entryId || "").toLowerCase();
  var content = entry.content && typeof entry.content === "object" ? entry.content : {};

  if (id.indexOf("cursor-") === 0) return "keep";

  if (id.indexOf("promoted") === 0) {
    stats.promotedId++;
    return "drop";
  }
  if (config.removePromotedTweets && hasPromotedMetadata(content.itemContent)) {
    stats.promotedItem++;
    return "drop";
  }
  if (config.removeAdCarousels && content.displayType === "Carousel") {
    stats.carousel++;
    return "drop";
  }
  if (config.removeWhoToFollow && (id.indexOf("who-to-follow") === 0 || id.indexOf("whotofollow") === 0)) {
    stats.whoToFollow++;
    return "drop";
  }
  if (config.removeMessagePrompt && (id.indexOf("messageprompt") === 0 ||
      id.indexOf("message-prompt") === 0 || id.indexOf("messages-") === 0)) {
    stats.messagePrompt++;
    return "drop";
  }

  if (config.removePromotedTweets && Array.isArray(content.items)) {
    var kept = [];
    for (var i = 0; i < content.items.length; i++) {
      var item = content.items[i];
      var inner = item && item.item && item.item.itemContent;
      if (hasPromotedMetadata(inner)) stats.promotedModuleItems++;
      else kept.push(item);
    }
    if (kept.length !== content.items.length) {
      if (kept.length === 0) {
        stats.emptiedModules++;
        return "drop";
      }
      content.items = kept;
      return "filtered";
    }
  }
  return "keep";
}

// Filters every array stored under an "entries" key, at any depth. Single "entry" objects
// (TimelineReplaceEntry, TimelinePinEntry) are not visited.
function walk(node, config, stats, depth) {
  if (!node || typeof node !== "object" || depth > 12) return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) walk(node[i], config, stats, depth + 1);
    return;
  }
  for (var key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    var value = node[key];
    if (key === "entries" && Array.isArray(value)) {
      var kept = [];
      for (var j = 0; j < value.length; j++) {
        stats.total++;
        var verdict = processEntry(value[j], config, stats);
        if (verdict === "drop") stats.removed++;
        else {
          if (verdict === "filtered") stats.changed++;
          kept.push(value[j]);
        }
      }
      node[key] = kept;
    } else if (key !== "entry") {
      walk(value, config, stats, depth + 1);
    }
  }
}

function run() {
  var config = applyArguments(CONFIG);
  var response = typeof $response !== "undefined" ? $response : {};
  var text = bodyToString(response.body);
  if (!text) {
    $done({});
    return;
  }
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    if (config.debug) console.log(TAG + ": response left unchanged (not JSON: " + e + ")");
    $done({});
    return;
  }
  var stats = {
    total: 0, removed: 0, changed: 0, promotedId: 0, promotedItem: 0, promotedModuleItems: 0,
    emptiedModules: 0, carousel: 0, whoToFollow: 0, messagePrompt: 0,
  };
  walk(data, config, stats, 0);
  if (config.debug) {
    console.log(TAG + ": entries " + stats.total + ", removed " + stats.removed +
      " (promoted id " + stats.promotedId + ", promoted item " + stats.promotedItem +
      ", carousel " + stats.carousel + ", who to follow " + stats.whoToFollow +
      ", message prompt " + stats.messagePrompt + ", emptied modules " + stats.emptiedModules +
      "), module items removed " + stats.promotedModuleItems);
  }
  if (stats.removed === 0 && stats.changed === 0) {
    $done({});
    return;
  }
  $done({ body: JSON.stringify(data) });
}

try {
  run();
} catch (e) {
  console.log(TAG + ": response left unchanged (" + e + ")");
  $done({});
}
