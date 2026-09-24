// Gera js/emoji-data.js a partir do emojibase-data (nomes e palavras-chave em
// português). Rodar quando quiser atualizar os emojis:
//   npm pack emojibase-data && tar xzf emojibase-data-*.tgz
//   node tools/build-emoji-data.mjs package/pt/data.json
// Formato: groups[{ key, label, icon, emojis: [[emoji, nome, palavras, versão, tons?]] }]
// "tons" = as 5 variantes de tom de pele (claro → escuro), quando existem.
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) throw new Error("Informe o caminho do pt/data.json do emojibase-data.");
const data = JSON.parse(readFileSync(src, "utf8"));
const GROUPS = [
  [0, "smileys", "Carinhas e emoções", "😀"],
  [1, "people", "Pessoas", "👋"],
  [3, "animals", "Animais e natureza", "🐻"],
  [4, "food", "Comidas e bebidas", "🍔"],
  [5, "travel", "Viagens e lugares", "🚗"],
  [6, "activities", "Atividades", "⚽"],
  [7, "objects", "Objetos", "💡"],
  [8, "symbols", "Símbolos", "💟"],
  [9, "flags", "Bandeiras", "🏳️"],
];
const fromHex = (hex) => String.fromCodePoint(...hex.split("-").map((h) => parseInt(h, 16)));
const groups = GROUPS.map(([id, key, label, icon]) => {
  const emojis = data
    .filter((e) => e.group === id)
    .sort((a, b) => a.order - b.order)
    .map((e) => {
      const tags = [...new Set((e.tags || []).filter((t) => !e.label.includes(t)))].join(" ");
      // emojis que por padrão são texto (❤, ☺, ☀…) precisam do FE0F para sair coloridos
      const glyph = e.type === 0 && !e.hexcode.includes("-") ? `${fromHex(e.hexcode)}\uFE0F` : fromHex(e.hexcode);
      const row = [glyph, e.label, tags, e.version];
      const tones = (e.skins || []).filter((s) => typeof s.tone === "number").sort((a, b) => a.tone - b.tone);
      if (tones.length === 5) row.push(tones.map((s) => fromHex(s.hexcode)));
      return row;
    });
  return { key, label, icon, emojis };
});
const total = groups.reduce((n, g) => n + g.emojis.length, 0);
const out = `// Gerado por tools/build-emoji-data.mjs a partir do emojibase-data (MIT, © Miles Johnson). Não edite à mão.
// ${total} emojis com nomes e palavras-chave em português.
globalThis.OrbitaEmojiData = ${JSON.stringify({ source: "emojibase-data", groups })};
`;
writeFileSync(new URL("../js/emoji-data.js", import.meta.url), out);
console.log(`js/emoji-data.js: ${total} emojis, ${(out.length / 1024).toFixed(0)} KB`);
