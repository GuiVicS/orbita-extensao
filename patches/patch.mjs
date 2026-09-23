// Uso: node patch.mjs <arquivo> <patch.json>   (patch.json = [{before, after}, ...])
// Aplica substituições exatas; falha se algum trecho não aparecer exatamente 1 vez.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [file, patchFile] = process.argv.slice(2);
let src = readFileSync(file, "utf8");
for (const { before, after } of JSON.parse(readFileSync(patchFile, "utf8"))) {
  const n = src.split(before).length - 1;
  if (n !== 1) { console.error(`ABORTADO: trecho encontrado ${n}x: ${before.slice(0, 80)}…`); process.exit(1); }
  src = src.replace(before, () => after);
}
const tmp = join(tmpdir(), "orbita-patch-check.js");
writeFileSync(tmp, src);
execFileSync(process.execPath, ["--check", tmp], { stdio: "inherit" });
writeFileSync(file, src);
unlinkSync(tmp);
console.log(`OK: ${file}`);
