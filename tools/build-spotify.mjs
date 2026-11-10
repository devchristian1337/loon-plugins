// Builds Scripts/Spotify/spot-proto-ev3.js from src/Spotify/proto.js: inlines the configuration
// snapshots of src/Spotify/config and minifies the result with terser.
import { minify } from "terser";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = resolve(root, "src/Spotify/proto.js");
const outPath = resolve(root, "Scripts/Spotify/spot-proto-ev3.js");
const snapshots = {
  SNAPSHOT_LEGACY: "src/Spotify/config/resolveconfiguration.json",
  SNAPSHOT_9_1_76: "src/Spotify/config/resolveconfiguration_9_1_76.json",
};

let source = await readFile(srcPath, "utf8");
const sha = createHash("sha256").update(source).digest("hex");
for (const [name, file] of Object.entries(snapshots)) {
  const json = JSON.parse(await readFile(resolve(root, file), "utf8"));
  const marker = `/*@${name}@*/ null`;
  if (!source.includes(marker)) throw new Error(`marker ${marker} not found in ${srcPath}`);
  source = source.replace(marker, JSON.stringify(json));
  console.log(`${name}: ${json.assignedValues.length} values from ${file}`);
}
const result = await minify(source, {
  ecma: 5,
  compress: { passes: 2, keep_fargs: true },
  mangle: { toplevel: false },
  format: {
    comments: false,
    preamble: `/**\n * Author: devchristian1337\n * Purpose: auto-generated Spotify bootstrap/customize patch; original sources are kept in src/Spotify/proto.js\n * and the configuration snapshots in src/Spotify/config. Build: npm run build (terser). Source SHA-256: ${sha}\n */`,
  },
});
if (!result.code) throw new Error("terser produced no output");
await writeFile(outPath, result.code + "\n");
console.log(`spot-proto-ev3.js: ${source.length} -> ${result.code.length} bytes`);
