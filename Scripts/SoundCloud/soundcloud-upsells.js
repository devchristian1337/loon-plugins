// Removes the upgrade entry points that SoundCloud for iOS loads from its GraphQL API:
// the "listen without ads" badge (navBar) and the Upgrade tab (tabBar) returned by the
// iosAppleUpsellsLegacy query. Every other GraphQL response is passed through unchanged.

const MARKER = '"appleUpsellsLegacy"';

try {
  const body = $response.body;
  if (typeof body !== "string" || !body.includes(MARKER)) {
    $done({});
  } else {
    const obj = JSON.parse(body);
    const upsells = obj && obj.data && obj.data.appleUpsellsLegacy;
    if (!upsells || typeof upsells !== "object") {
      $done({});
    } else {
      upsells.navBar = null;
      upsells.tabBar = null;
      $done({ body: JSON.stringify(obj) });
    }
  }
} catch (e) {
  console.log(`SoundCloud: GraphQL response left unchanged (${e})`);
  $done({});
}
