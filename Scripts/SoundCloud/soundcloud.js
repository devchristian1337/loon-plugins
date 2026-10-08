// Unlocks SoundCloud Go+ by rewriting the plan and feature flags of the iOS configuration.
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

try {
  const obj = JSON.parse($response.body);
  obj.plan = plan;
  obj.features = features;
  $done({ body: JSON.stringify(obj) });
} catch (e) {
  console.log(`SoundCloud: response left unchanged (${e})`);
  $done({});
}
