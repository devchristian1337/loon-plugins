// Unlocks SoundCloud Go+ by rewriting the plan and feature flags of the iOS configuration,
// and, when the "hide_upsells" argument is on (default), empties the upgrade entry points
// (Upgrade tab, "listen without ads" badge) it lists in upsells.
// Recent app versions load those entry points from the GraphQL API instead: see soundcloud-upsells.js.
// Any unexpected response (empty body, not JSON) is passed through unchanged.

const plan = {
  vendor: "apple",
  id: "high_tier",
  manageable: true,
  plan_upsells: [],
  plan_id: "go-plus",
  upsells: [],
  plan_name: "SoundCloud Go+",
};

const features = [
  { name: "offline_sync", enabled: true, plans: ["mid_tier", "high_tier"] },
  { name: "no_audio_ads", enabled: true, plans: ["mid_tier", "high_tier"] },
  { name: "hq_audio", enabled: true, plans: ["high_tier"] },
  { name: "system_playlist_in_library", enabled: true, plans: [] },
  { name: "ads_krux", enabled: false, plans: [] },
  { name: "new_home", enabled: true, plans: [] },
  { name: "spotlight", enabled: false, plans: [] },
];

function hideUpsells() {
  const value = typeof $argument === "object" && $argument ? $argument.hide_upsells : undefined;
  return value === undefined || value === true || value === "true";
}

try {
  const obj = JSON.parse($response.body);
  obj.plan = plan;
  obj.features = features;
  if (hideUpsells()) obj.upsells = {};
  $done({ body: JSON.stringify(obj) });
} catch (e) {
  console.log(`SoundCloud: response left unchanged (${e})`);
  $done({});
}
