// Minifica i sorgenti di src/YouTube in Scripts/YouTube/*.min.js con terser.
import { minify } from "terser";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["request", "response"];

for (const name of targets) {
  const srcPath = resolve(root, "src/YouTube", `${name}.js`);
  const outPath = resolve(root, "Scripts/YouTube", `${name}.min.js`);
  const source = await readFile(srcPath, "utf8");
  const sha = createHash("sha256").update(source).digest("hex");
  const result = await minify(source, {
    ecma: 5,
    compress: { passes: 2, keep_fargs: true },
    mangle: { toplevel: false },
    format: {
      comments: false,
      preamble: `/**\n * Author: devchristian1337\n * Purpose: auto-generated ${name} script; original sources are kept in src/YouTube/${name}.js.\n * Build: npm run build (terser). Source SHA-256: ${sha}\n */`,
    },
  });
  if (!result.code) throw new Error(`terser produced no output for ${name}`);
  await writeFile(outPath, result.code + "\n");
  console.log(`${name}.min.js: ${source.length} -> ${result.code.length} bytes`);
}
