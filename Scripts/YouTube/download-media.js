// YouTube native download, media step (experimental). The media URLs merged into the player
// answer come from the Oculus client (or the Android client as fallback); the media servers
// refuse (403) a request for such a URL whose user agent does not belong to that client, and
// the app's downloader presents itself as CFNetwork. This script runs on the media requests
// that carry one of those URLs (parameter c=ANDROID_VR or c=ANDROID) and sets the matching
// user agent, leaving every other header and the body untouched. It also covers the URL
// opened in Safari from the download-link notification.

var VERSION = "v1";

var USER_AGENTS = {
  ANDROID_VR: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  ANDROID: "com.google.android.youtube/20.10.38 (Linux; U; Android 13; Pixel 7) gzip"
};

function enabled() {
  var a = typeof $argument === "undefined" ? null : $argument;
  if (a && typeof a === "object" && !Array.isArray(a)) a = "native_download" in a ? a.native_download : a[Object.keys(a)[0]];
  else if (Array.isArray(a)) a = a[0];
  if (a === true) return true;
  var s = String(a === null || a === undefined ? "" : a).trim().toLowerCase().replace(/^\[|\]$/g, "").split(",")[0].trim();
  if (s.indexOf("=") >= 0) s = s.split("=")[1].trim();
  return s === "true" || s === "1";
}

try {
  var url = String($request.url || "");
  var match = /[?&]c=(ANDROID_VR|ANDROID)(?:&|$)/.exec(url);
  if (!enabled() || !match) {
    $done({});
  } else {
    var headers = {}, source = $request.headers || {}, keys = Object.keys(source), i, current = "";
    for (i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === "user-agent") { current = String(source[keys[i]]); continue; }
      headers[keys[i]] = source[keys[i]];
    }
    headers["User-Agent"] = USER_AGENTS[match[1]];
    console.log("YouTube download media " + VERSION + ": user agent set to " + match[1] + " (was " + current.slice(0, 40) + ")");
    $done({ headers: headers });
  }
} catch (e) {
  console.log("YouTube download media: left unchanged (" + e + ")");
  $done({});
}
