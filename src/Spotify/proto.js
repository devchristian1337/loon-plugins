/**
 * Author: devchristian1337
 * Source of Scripts/Spotify/spot-proto-ev3.js. Edit this file, then run "npm run build" from the repository
 * root to regenerate the script: the build inlines the configuration snapshots of src/Spotify/config.
 *
 * Patches the Spotify responses that carry the remote configuration and the account attributes:
 * bootstrap/v1/bootstrap and user-customization-service/v1/customize (both together), and since app 9.1.98
 * remote-config-resolver/v3/configuration (the configuration alone, refreshed after login) and
 * nebula/v1/configuration/attributes (the account attributes alone). The protobuf is walked field by
 * field and only the known path is rewritten; every other field, known or not, is copied verbatim, so a
 * new field added by the app is never dropped.
 *
 *   BootstrapMessage        2: wrapper -> 1: success -> 1: CustomizeMessage    3: trials facade (removed)
 *   CustomizeMessage        1: UcsResponse (success)   2: error
 *   remote-config-resolver  ResolveResponse (1: ResolveConfiguration) at the top level
 *   nebula attributes       AccountAttributesResponse at the top level
 *   UcsResponse             1: ResolveResponse  3: AccountAttributesResponse  5: fetch time
 *   ResolveResponse         1: ResolveConfiguration
 *   ResolveConfiguration    1: assignment id  2: fetch time  3: AssignedValue (repeated)  4: policy snapshot
 *   AssignedValue           1: {1 scope, 2 name}  2: metadata  3: {1 bool}  4: {1 int32}  5: {1 enum string}
 *   AccountAttributesResponse  1: map entry {1 key, 2 AccountAttribute {2 bool, 3 int64, 4 string}}
 *
 * The resolved configuration is replaced by a Premium snapshot matching the app version (one for apps
 * older than 9.1.76, one for 9.1.76 and newer), the live messaging assignments of the account are kept,
 * then the ad, upsell and capping rules are applied and the account attributes are set to Premium.
 */
var SNAPSHOT_LEGACY = /*@SNAPSHOT_LEGACY@*/ null;
var SNAPSHOT_9_1_76 = /*@SNAPSHOT_9_1_76@*/ null;
var SNAPSHOT_SWITCH_VERSION = [9, 1, 76];

// Assignments bound to the account: a snapshot taken from another cohort would hide the chat UI.
var LIVE_ASSIGNMENT_KEYS = {
  "ios-campfire-properties-impl.campfire_feature_enabled": true,
  "ios-feature-sidedrawer-platform.is_list_page_enabled": true,
};

// Real account entitlements: the server rejects the operation anyway, spoofing them only breaks the UI.
var SERVER_AUTHORITATIVE_ATTRIBUTES = [
  "offline",
  "can-use-offline",
  "has-offline-state",
  "max-offline-downloads-per-device",
  "max-offline-tracks",
  "offline-backup",
  "lyrics-offline",
  "very-high-bitrate",
  "audio-quality",
  "social-session",
  "social-session-free-tier",
  "jam-social-session",
];

// Targeted changes applied after the snapshot: [name, scope, action, value].
// remove: drop every match; setBool/setEnum: change the matches; forceBool: change the matches or append.
var RULES = [
  ["crossfade_enabled", "ios-feature-settings", "forceBool", true],
  ["automix_enabled", "ios-feature-settings", "forceBool", true],
  ["crossfade_enabled", "core-playback-setup", "forceBool", true],
  ["use_playback_settings_crossfade", "ios-feature-settings", "forceBool", false],
  ["use_playback_settings_gapless", "ios-feature-settings", "forceBool", false],
  // capping
  ["enable_common_capping", null, "remove"],
  ["enable_pns_common_capping", null, "remove"],
  ["enable_pick_and_shuffle_common_capping", null, "remove"],
  ["enable_pick_and_shuffle_dynamic_cap", null, "remove"],
  ["pick_and_shuffle_timecap", null, "remove"],
  [null, "ios-feature-queue", "remove"],
  ["enable_free_on_demand_experiment", null, "remove"],
  ["enable_free_on_demand_context_menu_experiment", null, "remove"],
  ["enable_mft_plus_queue", null, "remove"],
  ["enable_mft_plus_extended_queue", null, "remove"],
  ["enable_playback_timeout_service", null, "setBool", false],
  ["enable_playback_timeout_error_ui", null, "setBool", false],
  ["playback_timeout_action", null, "setEnum", "Nothing"],
  ["is_remove_from_queue_enabled_for_mft_plus", null, "remove"],
  ["is_reordering_for_mft_plus_allowed", null, "remove"],
  // ads and campaigns
  ["ads", null, "setBool", false],
  ["ad_metadata", null, "remove"],
  ["ad_slots", null, "remove"],
  ["enable_ads", null, "setBool", false],
  ["enable_audio_ads", null, "setBool", false],
  ["enable_display_ads", null, "setBool", false],
  ["enable_video_ads", null, "setBool", false],
  ["enable_premium_upsell", null, "setBool", false],
  ["enable_upsell", null, "setBool", false],
  ["show_upsell", null, "setBool", false],
  ["show_premium_upsell", null, "setBool", false],
  ["enable_campaigns", null, "setBool", false],
  ["enable_promotions", null, "setBool", false],
  ["enable_search_upsell", null, "setBool", false],
  ["enable_home_upsell", null, "setBool", false],
  // free-tier prompts moved into dedicated services since 9.1.66
  ["is_enabled_pt2", "ios-feature-shuffletoggleupsell", "forceBool", false],
  ["linear_upsell_new_style_experiment_enabled", "ios-feature-shuffletoggleupsell", "forceBool", false],
  ["play_modes_upsell_new_style_experiment_enabled", "ios-feature-shuffletoggleupsell", "forceBool", false],
  ["free_user_shuffle_upsell_sheet_enabled", "ios-jam-freeusershuffleupsellsheetpage-impl", "forceBool", false],
  ["free_user_skip_upsell_sheet_enabled", "ios-jam-freeuserskipupsellpage-impl", "forceBool", false],
  ["free_hosted_jams_upsell_enabled", "ios-jam-freehostedjamsupsell-impl", "forceBool", false],
  ["premium_gated_start_jam_buttons_enabled", "ios-sociallistening-configuration-impl", "forceBool", false],
  ["is_promo_cta_enabled", "ios-reinventfree-contextualupsellpremiumpromo-impl", "forceBool", false],
  ["show_time_cap_upsell_with_premium_badge", "ios-reinventfree-contextualupsellpremiumpromo-impl", "forceBool", false],
  ["enable_video_time_cap_upsell", "ios-reinventfree-controllerui-impl", "forceBool", false],
  ["enable_video_time_cap_upsell_on_search", "ios-reinventfree-controllerui-impl", "forceBool", false],
  ["music_video_upsell_enabled", "ios-reinventfree-timecappivot-impl", "forceBool", false],
  ["is_gbb_upsell_enabled", "ios-settings-mediaqualitypageplugin-impl", "forceBool", false],
  ["should_show_pigeon_upsell", "ios-settings-mediaqualitypageplugin-impl", "forceBool", false],
  ["preview_ended_upsell_enabled", "ios-system-listeningparties", "forceBool", false],
  ["enable_sponsored_content", null, "setBool", false],
  ["enable_sponsored_playlists", null, "setBool", false],
  ["enable_sponsored_sessions", null, "setBool", false],
  // ad on app open (home banner)
  [null, "ios-ad-on-app-open", "remove"],
  [null, "ios-feature-adonappopen", "remove"],
  ["is_ad_on_app_open_enabled", null, "setBool", false],
  ["ad_on_app_open_enabled", null, "setBool", false],
  ["adonappopen_enabled", null, "setBool", false],
  // marquee and leave-behind overlays
  [null, "marquee", "remove"],
  [null, "ios-feature-marquee", "remove"],
  [null, "leavebehindadsbase", "remove"],
  [null, "ios-feature-leavebehindadsbase", "remove"],
  ["unified_leavebehind_npv_scroll_music_enabled", "ios-nowplaying-scroll-impl", "forceBool", false],
  ["unified_leavebehind_npv_scroll_podcast_enabled", "ios-nowplaying-scroll-impl", "forceBool", false],
  ["use_unified_leavebehind_fetch", "ios-feature-embeddedplaylist", "forceBool", false],
  ["foreground_enabled", "ios-adsnowplaying-embeddednpv-impl", "forceBool", false],
  ["music_track_change_enabled", "ios-adsnowplaying-embeddednpv-impl", "forceBool", false],
  ["enable_ads_on_podcast", "ios-adsnowplaying-embeddednpv-impl", "forceBool", false],
  // in-stream, embedded and platform ad scopes
  [null, "ios-feature-instreamads", "remove"],
  [null, "ios-adsembedded-embeddedctaelements-impl", "remove"],
  [null, "ios-adsnowplaying-embeddednpv-impl", "remove"],
  [null, "ios-adsplatform-elementimpl", "remove"],
  [null, "ios-system-adssponsoredcontext", "remove"],
  ["enable_ads_connect_state_observer", "ios-feature-adsbase", "setBool", false],
  ["enable_minimal_preroll_management", "ios-feature-adsbase", "setBool", false],
  ["enable_swift_ads_base_movement_logger", "ios-feature-adsbase", "setBool", false],
  [null, "ios-feature-adsswift", "remove"],
  ["embedded_npv_video_show_with_canvas", "ios-feature-adsnowplayingui", "forceBool", false],
  ["sponsored_context_mismatch_aderror_enabled", "ios-feature-adssponsoredcontext", "setBool", false],
  ["sponsored_playlist_v2_enabled", "ios-feature-adssponsoredcontext", "setBool", false],
  ["sponsored_npb_slot_fetch_enabled", "ios-feature-adssponsoredcontextnpbattachment", "setBool", false],
  [null, "ios-feature-adsidentitytracking", "remove"],
  // search page promotions
  ["prompted_playlist_merchandizing_enabled", "ios-feature-search", "setBool", false],
  ["social_proof_playlist_enabled", "ios-feature-search", "setBool", false],
  ["social_proof_plays_in_search_enabled", "ios-feature-search", "setBool", false],
  ["video_carousel_section_enabled", "ios-feature-search", "setBool", false],
  ["watch_feed_section_enabled", "ios-feature-search", "setBool", false],
  // legacy unscoped flags
  ["enable_popups", null, "setBool", false],
  ["enable_leave_behind_ads_card_element", null, "setBool", false],
  ["music_npv_leavebehinds_enabled", null, "setBool", false],
  ["enable_ads_on_podcast", null, "setBool", false],
  ["enable_display_element", null, "setBool", false],
  ["enable_video_element", null, "setBool", false],
  ["is_promo_cta_enabled", null, "setBool", false],
  ["show_time_cap_upsell_with_premium_badge", null, "setBool", false],
  ["enable_video_time_cap_upsell", null, "setBool", false],
  ["enable_video_time_cap_upsell_on_search", null, "setBool", false],
  ["music_video_upsell_enabled", null, "setBool", false],
  ["is_gbb_upsell_enabled", null, "setBool", false],
  ["should_show_pigeon_upsell", null, "setBool", false],
  ["disable_suggested_tracks_upsell", null, "setBool", true],
  ["is_enabled_pt2", null, "setBool", false],
  ["show_skip_button_during_skippable_ads", null, "setBool", true],
  ["sponsored_playlist_v2_header_dismissible", null, "setBool", true],
  ["use_mock_sponsorship_endpoint", null, "setBool", false],
  ["enable_popup", null, "setBool", false],
  ["show_popups", null, "setBool", false],
  ["show_popup", null, "setBool", false],
  ["enable_interstitials", null, "setBool", false],
  ["enable_interstitial", null, "setBool", false],
  ["enable_overlays", null, "setBool", false],
  ["enable_overlay", null, "setBool", false],
  ["enable_promotions_on_home", null, "setBool", false],
  ["enable_promotions_on_search", null, "setBool", false],
  ["enable_billboard", null, "setBool", false],
  ["enable_billboards", null, "setBool", false],
  ["should_nova_scroll_use_scrollsita", null, "remove"],
  // lyrics sharing is gated behind a premium-only flag
  ["enable_lyrics_share", "ios-feature-lyrics", "forceBool", true],
  ["lyrics_share_enabled", "ios-feature-lyrics", "forceBool", true],
  ["enable_lyrics_sharing", "ios-feature-lyrics", "forceBool", true],
  ["is_lyrics_share_enabled", "ios-feature-lyrics", "forceBool", true],
  ["lyrics_shareable", "ios-feature-lyrics", "forceBool", true],
  ["enable_share_link_preview_uploads", "ios-feature-lyrics", "forceBool", true],
  ["enable_sharing_v2", "ios-feature-lyrics", "forceBool", true],
];

// Names that look like ad flags but must stay on (they hide or shorten ads).
var COHORT_KEEP = /^disable_|dismissible|skip_button/;
var COHORT_TOKENS = {
  ad: 1, ads: 1, adsbase: 1, adsswift: 1, adonappopen: 1, instreamads: 1,
  leavebehind: 1, leavebehinds: 1, leavebehindadsbase: 1, marquee: 1,
  upsell: 1, upsells: 1, sponsored: 1, adssponsoredcontext: 1, realtimead: 1,
};

// ---------------------------------------------------------------------------------------------------
// Protobuf helpers (wire types 0, 1, 2 and 5; values above 2^53 are not expected in these messages).

function readVarint(b, p) {
  var v = 0, m = 1;
  for (;;) {
    if (p >= b.length) throw new Error("truncated varint");
    var c = b[p++];
    v += (c & 0x7f) * m;
    if ((c & 0x80) === 0) return { value: v, pos: p };
    m *= 128;
  }
}
function writeVarint(v) {
  var out = [];
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}
function concat(parts) {
  var n = 0, i;
  for (i = 0; i < parts.length; i++) n += parts[i].length;
  var out = new Uint8Array(n), o = 0;
  for (i = 0; i < parts.length; i++) {
    out.set(parts[i], o);
    o += parts[i].length;
  }
  return out;
}
// Splits one message into its fields; each field keeps its raw bytes and, for wire type 2, its payload.
function parseFields(b) {
  var fields = [], p = 0;
  while (p < b.length) {
    var start = p, key = readVarint(b, p), no = Math.floor(key.value / 8), wire = key.value % 8;
    p = key.pos;
    var payloadStart = -1;
    if (wire === 0) p = readVarint(b, p).pos;
    else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else if (wire === 2) {
      var len = readVarint(b, p);
      payloadStart = len.pos;
      p = len.pos + len.value;
    } else throw new Error("unsupported wire type " + wire);
    if (p > b.length) throw new Error("truncated field " + no);
    fields.push({ no: no, wire: wire, raw: b.subarray(start, p), payload: wire === 2 ? b.subarray(payloadStart, p) : null });
  }
  return fields;
}
function encodeLengthDelimited(no, payload) {
  return concat([new Uint8Array(writeVarint(no * 8 + 2)), new Uint8Array(writeVarint(payload.length)), payload]);
}
// A negative int32 is a 64-bit two's complement varint (10 bytes): high word all ones, low word the value.
function writeVarintSigned(v) {
  if (v >= 0) return writeVarint(v);
  var lo = v >>> 0, hi = 0xffffffff, out = [];
  for (var i = 0; i < 9; i++) {
    out.push((lo & 0x7f) | 0x80);
    lo = ((lo >>> 7) | (hi << 25)) >>> 0;
    hi = hi >>> 7;
  }
  out.push(lo & 0x7f);
  return out;
}
function encodeVarintField(no, value) {
  return new Uint8Array(writeVarint(no * 8).concat(writeVarintSigned(value)));
}
// Reads a varint as int32: a 10-byte varint carries a negative value in its low 32 bits.
function readInt32(b, p) {
  var lo = 0, i = 0;
  for (;;) {
    if (p >= b.length) throw new Error("truncated varint");
    var c = b[p++];
    if (i < 5) lo |= (c & 0x7f) << (7 * i);
    i++;
    if ((c & 0x80) === 0) break;
  }
  return i > 5 ? lo | 0 : lo >>> 0;
}
function utf8Encode(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}
function utf8Decode(b) {
  var s = "", i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    else if (c < 0xf0) s += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
    else {
      var cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}
// Rewrites the payload of the fields numbered "no" through "fn"; the other fields are copied as they are.
function mapField(b, no, fn) {
  var fields = parseFields(b), out = [], hit = false;
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.no === no && f.wire === 2) {
      hit = true;
      var r = fn(f.payload);
      if (r !== null) out.push(encodeLengthDelimited(no, r));
    } else out.push(f.raw);
  }
  return { bytes: concat(out), hit: hit };
}

// ---------------------------------------------------------------------------------------------------
// Assigned values (remote configuration).

function decodeAssignedValue(payload) {
  var v = { scope: "", name: "", metadata: null, kind: null, value: null, raw: payload };
  var fields = parseFields(payload);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.no === 1 && f.wire === 2) {
      var id = parseFields(f.payload);
      for (var j = 0; j < id.length; j++) {
        if (id[j].no === 1 && id[j].wire === 2) v.scope = utf8Decode(id[j].payload);
        if (id[j].no === 2 && id[j].wire === 2) v.name = utf8Decode(id[j].payload);
      }
    } else if (f.no === 2 && f.wire === 2) v.metadata = f.raw;
    else if ((f.no === 3 || f.no === 4 || f.no === 5) && f.wire === 2) {
      var inner = parseFields(f.payload);
      v.kind = f.no === 3 ? "bool" : f.no === 4 ? "int" : "enum";
      v.value = v.kind === "bool" ? false : v.kind === "int" ? 0 : "";
      for (var k = 0; k < inner.length; k++) {
        if (inner[k].no !== 1) continue;
        if (v.kind === "enum" && inner[k].wire === 2) v.value = utf8Decode(inner[k].payload);
        else if (v.kind !== "enum" && inner[k].wire === 0) {
          var n = readInt32(inner[k].raw, readVarint(inner[k].raw, 0).pos);
          v.value = v.kind === "bool" ? n !== 0 : n;
        }
      }
    }
  }
  return v;
}
function encodeAssignedValue(v) {
  var parts = [];
  parts.push(encodeLengthDelimited(1, concat([encodeLengthDelimited(1, utf8Encode(v.scope)), encodeLengthDelimited(2, utf8Encode(v.name))])));
  if (v.metadata) parts.push(v.metadata);
  if (v.kind === "bool") parts.push(encodeLengthDelimited(3, v.value ? encodeVarintField(1, 1) : new Uint8Array(0)));
  else if (v.kind === "int") parts.push(encodeLengthDelimited(4, v.value ? encodeVarintField(1, v.value) : new Uint8Array(0)));
  else if (v.kind === "enum") parts.push(encodeLengthDelimited(5, encodeLengthDelimited(1, utf8Encode(v.value))));
  return concat(parts);
}
function encodeMetadata(m) {
  if (!m) return null;
  var parts = [];
  if (m.policyId) parts.push(encodeVarintField(1, Number(m.policyId)));
  if (m.externalRealm) parts.push(encodeLengthDelimited(2, utf8Encode(m.externalRealm)));
  if (m.externalRealmId) parts.push(encodeVarintField(3, Number(m.externalRealmId)));
  return encodeLengthDelimited(2, concat(parts));
}
function snapshotValues(snapshot) {
  var out = [];
  for (var i = 0; i < snapshot.assignedValues.length; i++) {
    var s = snapshot.assignedValues[i];
    var v = { scope: s.scope, name: s.name, metadata: encodeMetadata(s.metadata), kind: null, value: null };
    if (typeof s.boolValue === "boolean") { v.kind = "bool"; v.value = s.boolValue; }
    else if (typeof s.intValue === "number") { v.kind = "int"; v.value = s.intValue; }
    else if (typeof s.enumValue === "string") { v.kind = "enum"; v.value = s.enumValue; }
    out.push(v);
  }
  return out;
}
function isCohortAdOrUpsellFlag(scope, name) {
  if (COHORT_KEEP.test(name)) return false;
  var tokens = (scope + "." + name).toLowerCase().split(/[^a-z0-9]+/);
  for (var i = 0; i < tokens.length; i++) if (COHORT_TOKENS[tokens[i]] === 1) return true;
  return false;
}
function applyRules(values, stats) {
  for (var r = 0; r < RULES.length; r++) {
    var rule = RULES[r], name = rule[0], scope = rule[1], action = rule[2], value = rule[3], matched = 0;
    for (var i = values.length - 1; i >= 0; i--) {
      var v = values[i];
      if ((name !== null && v.name !== name) || (scope !== null && v.scope !== scope)) continue;
      matched++;
      if (action === "remove") values.splice(i, 1);
      else if (action === "setEnum") { v.kind = "enum"; v.value = value; }
      else { v.kind = "bool"; v.value = value; }
    }
    if (matched === 0 && action === "forceBool") {
      values.push({ scope: scope, name: name, metadata: null, kind: "bool", value: value });
      matched = 1;
    }
    if (matched) stats.rules += matched;
  }
  for (var j = 0; j < values.length; j++) {
    var w = values[j];
    if (w.kind === "bool" && w.value === true && isCohortAdOrUpsellFlag(w.scope, w.name)) {
      w.value = false;
      stats.cohort++;
    }
  }
}
function patchConfiguration(payload, snapshot, stats) {
  var fields = parseFields(payload), live = [], values = [], others = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.no === 3 && f.wire === 2) {
      var v = decodeAssignedValue(f.payload);
      values.push(v);
      if (LIVE_ASSIGNMENT_KEYS[v.scope + "." + v.name] === true) live.push(v);
    } else others.push(f);
  }
  stats.serverValues = values.length;
  var out = [];
  if (snapshot) {
    out.push(encodeLengthDelimited(1, utf8Encode(snapshot.configurationAssignmentId)));
    out.push(encodeVarintField(2, Number(snapshot.fetchTimeMillis)));
    values = snapshotValues(snapshot);
    for (var k = values.length - 1; k >= 0; k--) {
      if (LIVE_ASSIGNMENT_KEYS[values[k].scope + "." + values[k].name] === true) values.splice(k, 1);
    }
    for (var l = 0; l < live.length; l++) values.push(live[l]);
    stats.live = live.length;
  } else {
    for (var o = 0; o < others.length; o++) if (others[o].no !== 4) out.push(others[o].raw);
  }
  applyRules(values, stats);
  for (var m = 0; m < values.length; m++) out.push(encodeLengthDelimited(3, encodeAssignedValue(values[m])));
  if (snapshot) out.push(encodeVarintField(4, Number(snapshot.policySnapshotId)));
  else for (var q = 0; q < others.length; q++) if (others[q].no === 4) out.push(others[q].raw);
  stats.values = values.length;
  return concat(out);
}

// ---------------------------------------------------------------------------------------------------
// Account attributes.

function decodeAttributes(payload) {
  var entries = [], order = [], byKey = {}, fields = parseFields(payload);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.no !== 1 || f.wire !== 2) { entries.push({ raw: f.raw }); continue; }
    var kv = parseFields(f.payload), key = null, value = null;
    for (var j = 0; j < kv.length; j++) {
      if (kv[j].no === 1 && kv[j].wire === 2) key = utf8Decode(kv[j].payload);
      if (kv[j].no === 2 && kv[j].wire === 2) value = kv[j].payload;
    }
    if (key === null) { entries.push({ raw: f.raw }); continue; }
    if (byKey[key] === undefined) order.push(key);
    byKey[key] = { raw: value };
  }
  return { entries: entries, order: order, byKey: byKey };
}
// The attribute value is a oneof: a false bool is written explicitly, an empty message would mean "unset".
function attrBool(v) { return { raw: encodeVarintField(2, v ? 1 : 0) }; }
function attrString(s) { return { raw: encodeLengthDelimited(4, utf8Encode(s)) }; }
function attrStringValue(a) {
  if (!a || !a.raw) return null;
  var fields = parseFields(a.raw);
  for (var i = 0; i < fields.length; i++) if (fields[i].no === 4 && fields[i].wire === 2) return utf8Decode(fields[i].payload);
  return null;
}
function patchAttributes(payload, stats) {
  var map = decodeAttributes(payload), byKey = map.byKey, order = map.order, i;
  var authoritative = {};
  for (i = 0; i < SERVER_AUTHORITATIVE_ATTRIBUTES.length; i++) {
    var n = SERVER_AUTHORITATIVE_ATTRIBUTES[i];
    if (byKey[n] !== undefined) authoritative[n] = byKey[n];
  }
  stats.accountType = attrStringValue(byKey["type"]);
  function set(key, value) {
    if (byKey[key] === undefined) order.push(key);
    byKey[key] = value;
  }
  function unset(key) {
    if (byKey[key] === undefined) return;
    delete byKey[key];
    order.splice(order.indexOf(key), 1);
  }
  var oneYearFromNow = new Date();
  oneYearFromNow.setUTCFullYear(oneYearFromNow.getUTCFullYear() + 1);
  var isoDate = oneYearFromNow.toISOString().replace(/\.\d{3}Z$/, "Z");

  set("ads", attrBool(false));
  set("ab-ad-player-targeting", attrString("0"));
  set("allow-advertising-id-transmission", attrBool(false));
  set("restrict-advertising-id-transmission", attrBool(true));
  set("can_use_superbird", attrBool(true));
  set("enable-crossfade-product-state", attrString("1"));
  set("enable-gapless-product-state", attrString("1"));
  set("catalogue", attrString("premium"));
  set("financial-product", attrString("pr:premium,tc:0"));
  set("is-eligible-premium-unboxing", attrBool(true));
  set("name", attrString("Spotify Premium"));
  set("nft-disabled", attrString("1"));
  set("on-demand", attrBool(true));
  set("payments-initial-campaign", attrString("default"));
  set("player-license", attrString("premium"));
  set("player-license-v2", attrString("premium"));
  set("product-expiry", attrString(isoDate));
  set("shuffle-eligible", attrBool(true));
  set("streaming-rules", attrString(""));
  set("subscription-enddate", attrString(isoDate));
  set("type", attrString("premium"));
  set("unrestricted", attrBool(true));
  set("high-bitrate", attrBool(true));
  set("loudness-levels", attrString("1:-5.0,0.0,3.0:-2.0"));
  set("pick-and-shuffle", attrBool(false));
  set("mixing-tools", attrString("EDIT"));
  set("your-library-tags", attrBool(true));
  set("libspotify", attrBool(true));
  set("mobile", attrBool(true));

  unset("ad-use-adlogic");
  unset("ad-catalogues");
  unset("shuffle");
  unset("payment-state");
  unset("last-premium-activation-date");
  unset("on-demand-trial");
  unset("on-demand-trial-in-progress");
  unset("smart-shuffle");
  unset("at-signal");
  unset("feature-set-id-masked");
  unset("strider-key");
  unset("is-eligible-for-trial");
  unset("is-eligible-for-upsell");
  unset("upsell-state");
  unset("ad-session-persistence");
  unset("ad-formats-preroll-video");
  unset("is-premium-eligible");
  for (i = 1; i <= 100; i++) unset("is-premium-eligible-v" + i);

  // The real entitlements win over everything above.
  for (i = 0; i < SERVER_AUTHORITATIVE_ATTRIBUTES.length; i++) {
    var a = SERVER_AUTHORITATIVE_ATTRIBUTES[i];
    if (authoritative[a] !== undefined) set(a, authoritative[a]);
    else unset(a);
  }

  var out = [];
  for (i = 0; i < map.entries.length; i++) out.push(map.entries[i].raw);
  for (i = 0; i < order.length; i++) {
    var entry = concat([encodeLengthDelimited(1, utf8Encode(order[i])), encodeLengthDelimited(2, byKey[order[i]].raw)]);
    out.push(encodeLengthDelimited(1, entry));
  }
  stats.attributes = order.length;
  return concat(out);
}

// ---------------------------------------------------------------------------------------------------
// Message walk.

function patchUcs(payload, snapshot, stats) {
  var r = mapField(payload, 1, function (resolve) {
    return mapField(resolve, 1, function (configuration) {
      stats.configuration = true;
      return patchConfiguration(configuration, snapshot, stats);
    }).bytes;
  });
  var a = mapField(r.bytes, 3, function (attributes) {
    stats.attributesFound = true;
    return patchAttributes(attributes, stats);
  });
  return a.bytes;
}
function patchCustomize(payload, snapshot, stats) {
  return mapField(payload, 1, function (ucs) { return patchUcs(ucs, snapshot, stats); }).bytes;
}
// Layout checks for the top-level messages: bytes that do not parse are simply not that message.
function tryParse(b) {
  try {
    return parseFields(b);
  } catch (e) {
    return null;
  }
}
// Top-level ResolveConfiguration (remote-config-resolver): recognized by its assigned values in field 3.
function looksLikeConfiguration(payload) {
  var fields = tryParse(payload), found = 0;
  if (!fields) return false;
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].no === 3 && fields[i].wire === 2) {
      var v = null;
      try {
        v = decodeAssignedValue(fields[i].payload);
      } catch (e) {}
      if (!v || !v.scope || !v.name) return false;
      found++;
    } else if (fields[i].no > 4) return false;
  }
  return found > 0;
}
// Top-level AccountAttributesResponse (nebula): map entries in field 1 with a string key and a message value.
function looksLikeAttributes(payload) {
  var fields = tryParse(payload), found = 0;
  if (!fields) return false;
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].no !== 1 || fields[i].wire !== 2) return false;
    var kv = tryParse(fields[i].payload), key = false, value = false;
    if (!kv) return false;
    for (var j = 0; j < kv.length; j++) {
      if (kv[j].no === 1 && kv[j].wire === 2) key = true;
      else if (kv[j].no === 2 && kv[j].wire === 2 && tryParse(kv[j].payload)) value = true;
      else return false;
    }
    if (!key || !value) return false;
    found++;
  }
  return found > 0;
}
function describeLayout(payload) {
  var fields = parseFields(payload), out = [];
  for (var i = 0; i < fields.length && i < 12; i++) out.push(fields[i].no + ":" + fields[i].wire + ":" + fields[i].raw.length);
  return "[" + out.join(" ") + "]";
}
function patchBootstrap(payload, snapshot, stats) {
  var withoutTrials = mapField(payload, 3, function () { stats.trialsRemoved = true; return null; }).bytes;
  return mapField(withoutTrials, 2, function (wrapper) {
    return mapField(wrapper, 1, function (success) {
      return mapField(success, 1, function (customize) { return patchCustomize(customize, snapshot, stats); }).bytes;
    }).bytes;
  }).bytes;
}

// ---------------------------------------------------------------------------------------------------
// Runtime.

function headerValue(headers, name) {
  if (!headers) return "";
  var keys = Object.keys(headers), lower = name.toLowerCase();
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === lower) return String(headers[keys[i]]);
  return "";
}
// App version from the request: "Spotify/9.1.98 iOS/26.1 (...)" or the spotify-app-version header.
function appVersion(request) {
  var ua = headerValue(request.headers, "User-Agent"), m = /Spotify\/(\d+(?:\.\d+)+)/i.exec(ua);
  var s = m ? m[1] : headerValue(request.headers, "spotify-app-version");
  m = /^(\d+)\.(\d+)\.(\d+)/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function versionAtLeast(v, min) {
  for (var i = 0; i < 3; i++) {
    if (v[i] > min[i]) return true;
    if (v[i] < min[i]) return false;
  }
  return true;
}
function pickSnapshot(version) {
  if (version && !versionAtLeast(version, SNAPSHOT_SWITCH_VERSION)) return { name: "legacy", data: SNAPSHOT_LEGACY };
  return { name: "9.1.76", data: SNAPSHOT_9_1_76 };
}
function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") return utf8Encode(body);
  return null;
}
function finish(bytes) {
  if (typeof $prefs !== "undefined" && typeof $task !== "undefined") {
    $done({ bodyBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  } else $done({ body: bytes });
}
function main() {
  var status = $response.status !== undefined ? $response.status : $response.statusCode;
  if (status !== 200) {
    console.log("spotify-proto: status " + status + ", pass-through");
    return $done({});
  }
  var url = String($request.url || ""), method = String($request.method || "").toUpperCase();
  var kind = /bootstrap\/v1\/bootstrap/.test(url)
    ? "bootstrap"
    : /user-customization-service\/v1\/customize/.test(url)
      ? "customize"
      : /remote-config-resolver\/v\d+\/configuration/.test(url)
        ? "configuration"
        : /nebula\/v\d+\/configuration\/attributes/.test(url)
          ? "attributes"
          : null;
  if (!kind || (method !== "POST" && kind !== "attributes")) {
    console.log("spotify-proto: unexpected request " + method + " " + url);
    return $done({});
  }
  var body = toBytes($response.body);
  if (!body || !body.length) {
    console.log("spotify-proto: empty body, pass-through");
    return $done({});
  }
  var version = appVersion($request), snapshot = pickSnapshot(version);
  var stats = { rules: 0, cohort: 0, values: 0, serverValues: 0, live: 0, attributes: 0 };
  var out;
  if (kind === "bootstrap") out = patchBootstrap(body, snapshot.data, stats);
  else if (kind === "customize") out = patchCustomize(body, snapshot.data, stats);
  else if (kind === "configuration") {
    // ResolveResponse wraps the configuration in field 1; a bare configuration is accepted as well.
    var top = tryParse(body);
    if (top && top.length === 1 && top[0].no === 1 && top[0].wire === 2 && looksLikeConfiguration(top[0].payload)) {
      stats.configuration = true;
      out = mapField(body, 1, function (configuration) {
        return patchConfiguration(configuration, snapshot.data, stats);
      }).bytes;
    } else if (looksLikeConfiguration(body)) {
      stats.configuration = true;
      out = patchConfiguration(body, snapshot.data, stats);
    } else {
      console.log("spotify-proto: configuration has an unknown layout " + describeLayout(body) + ", pass-through");
      return $done({});
    }
  } else {
    if (!looksLikeAttributes(body)) {
      console.log("spotify-proto: attributes have an unknown layout " + describeLayout(body) + ", pass-through");
      return $done({});
    }
    stats.attributesFound = true;
    out = patchAttributes(body, stats);
  }
  if (!stats.configuration && !stats.attributesFound) {
    console.log("spotify-proto: " + kind + " has no configuration or attributes, pass-through");
    return $done({});
  }
  console.log(
    "spotify-proto: " + kind + " app=" + (version ? version.join(".") : "unknown") + " snapshot=" + snapshot.name +
      " values=" + stats.serverValues + "->" + stats.values + " (live " + stats.live + ", rules " + stats.rules +
      ", cohort " + stats.cohort + ") attributes=" + stats.attributes + " type=" + stats.accountType +
      (stats.trialsRemoved ? " trials-removed" : "") + " bytes=" + body.length + "->" + out.length,
  );
  finish(out);
}
try {
  main();
} catch (e) {
  console.log("spotify-proto: error " + (e && e.message ? e.message : e) + ", pass-through");
  $done({});
}
