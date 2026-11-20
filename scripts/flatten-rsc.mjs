// Next 16's static export writes segment payloads as folders
// (pais/BRA/__next.(atlas)/pais/$d$code/__PAGE__.txt) while the client router
// requests them with dots (pais/BRA/__next.(atlas).pais.$d$code.__PAGE__.txt).
// A Next server maps one to the other; a static host cannot, so copy each payload
// to the dotted name as well. Usage: node scripts/flatten-rsc.mjs out
import { copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2] ?? "out";
let copied = 0;

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.name.startsWith("__next.")) await flatten(full, dir, e.name);
    else await walk(full);
  }
}

async function flatten(segDir, parent, prefix) {
  for (const e of await readdir(segDir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const rel = path.relative(segDir, path.join(e.parentPath, e.name)).split(path.sep).join(".");
    await copyFile(path.join(e.parentPath, e.name), path.join(parent, `${prefix}.${rel}`));
    copied++;
  }
}

await walk(root);
console.log(`payloads achatados: ${copied}`);
