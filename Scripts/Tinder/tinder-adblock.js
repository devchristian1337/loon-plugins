// Hides the ads and the subscription upsells of the Tinder iOS app by rewriting two
// responses of api.gotinder.com:
//   /v2/meta     - the client configuration: the ad cadence in the card stack, the "levers"
//                  flags that enable the ad placements (card stack, Explore, match list,
//                  promos) and the upsell modals, tooltips and merchandising cards.
//   /v2/profile  - the account flags: "hide_ads" (what Tinder Plus turns on) and the
//                  paywall entry points.
// Premium features (unlimited likes, Rewind, Passport, Likes You) are enforced by the
// server and are deliberately left untouched. The ad SDKs themselves stay enabled so the
// rewarded video that grants extra likes keeps working. Any unexpected response is passed
// through unchanged.

// Levers switched off (ad placements, upsells and merchandising).
const LEVERS_OFF = [
  "ads.nimbus_recs_ads_enabled",
  "ads.ad_recs_injector_v3_enabled",
  "ads.ads_support_in_modes_enabled",
  "ads.explore_ads_enabled",
  "ads.matchlist_ads_enabled",
  "ads.plus_ads_enabled",
  "ads.promo_enabled",
  "ads.deep_link_ads_enabled",
  "ads.sponsored_message_enabled",
  "ads.sponsored_interest_native_modal_enabled",
  "boost.upsell_modal_enabled",
  "boost.likes_you_merchandising_enabled",
  "boost.get_likes_upsell_enabled",
  "boost.out_of_recs_upsell_enabled",
  "gold_home_v2.new_likes_upsell_enabled",
  "matches.platinum_upsell_enabled",
  "matches.platinum_upsell_v2_enabled",
  "platinum.match_list_upsell_enabled",
  "platinum.my_likes_entrypoint_upsell_enabled",
  "recs_client.likes_you_upsell_modal_enabled",
  "superlike.profile_merchandising_tooltip_enabled",
  "superlike.gamepad_merchandising_tooltip_enabled",
  "superlike.merchandising_tooltip_enabled",
  "superlike.upsell_high_rsrr_enabled",
  "engagement.merchandising_card_app_open_enabled",
  "engagement.merch_card_v2_mirror_enabled",
  "dynamic_content.is_merchandising_card_v2_enabled",
  "controlla_m2.mini_merch_card",
  "rebrand_o2.engagement_merch_card",
  "postmatch.read_receipt_upsell_in_empty_chat_enabled",
  "paywall.primetime_boost_upsell_enabled",
  "paywall.alc_discount_offer_paywall_enabled",
  "bundle_offers_paywall.is_enabled",
  "upsell_boost.relationship_intent_enabled",
];

// Levers switched on.
const LEVERS_ON = ["ads.hide_ads", "secret_admirer.hide_upsell"];

// Cadence high enough that no ad is ever inserted in the card stack (0 is avoided: the
// client may use it as a divisor).
const NO_ADS_CADENCE = 1000000;

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function patchMeta(data) {
  if (isObject(data.ads)) {
    if (isObject(data.ads.card_stack)) data.ads.card_stack.cadence = NO_ADS_CADENCE;
  }
  if (isObject(data.levers)) {
    const setLever = (name, value) => {
      const lever = data.levers[name];
      if (isObject(lever) && typeof lever.value === "boolean") lever.value = value;
    };
    LEVERS_OFF.forEach((name) => setLever(name, false));
    LEVERS_ON.forEach((name) => setLever(name, true));
    const cadence = data.levers["ads.cadence"];
    if (isObject(cadence) && typeof cadence.value === "number") cadence.value = NO_ADS_CADENCE;
    const secondary = data.levers["ads.secondary_cadence"];
    if (isObject(secondary) && typeof secondary.value === "number") secondary.value = NO_ADS_CADENCE;
  }
}

function patchProfile(data) {
  if (isObject(data.feature_access) && isObject(data.feature_access.ad_features)) {
    data.feature_access.ad_features.hide_ads = true;
  }
  if (isObject(data.plus_control)) data.plus_control.hide_ads = true;
  if (Array.isArray(data.entrypoints)) data.entrypoints = [];
  if (isObject(data.campaigns) && Array.isArray(data.campaigns.campaigns)) data.campaigns.campaigns = [];
}

try {
  const obj = JSON.parse($response.body);
  if (!isObject(obj) || !isObject(obj.data)) {
    $done({});
  } else {
    const url = $request.url;
    if (url.indexOf("/v2/meta") !== -1) patchMeta(obj.data);
    else patchProfile(obj.data);
    $done({ body: JSON.stringify(obj) });
  }
} catch (e) {
  console.log(`Tinder AdBlock: response left unchanged (${e})`);
  $done({});
}
