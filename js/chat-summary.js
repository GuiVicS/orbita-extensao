// Conversas — "Gerar resumo": o que aconteceu no WhatsApp desde o último resumo.
// Roda no service worker (importScripts) e as partes puras nos testes do Node.
// Expõe globalThis.OrbitaSummary.
//
// Por conversa:
//   1. prepare(): mensagens do período (+ algumas de antes, só como contexto),
//      sem ruído (figurinha, "ok", "kkk", mídia sem legenda), numeradas [1], [2]…
//      e marcadas quando são claramente para você (te marcou, respondeu você,
//      pergunta sem resposta sua depois).
//   2. a IA (provedor das Opções) devolve itens estruturados, cada um com os
//      números das mensagens de onde saiu.
//   3. parse(): só fica o item cuja fonte existe; a fonte vira a mensagem real
//      (id, hora, quem escreveu, trecho). Datas conferidas. Pergunta que você já
//      respondeu depois não conta como pendente.
// Depois, merge() junta as conversas (compromissos repetidos viram um só).
(() => {
  "use strict";
  if (globalThis.OrbitaSummary) return;

  const TYPES = ["question", "request", "commitment", "deadline", "notice", "decision", "link"];
  const NOISE = /^(ok+|okay|blz|beleza|show|top|kk+|k{2,}|ha(ha)+|rs+|👍+|🙏+|❤️+|😂+|obrigad[oa]s?|obg|vlw|valeu|bom dia|boa tarde|boa noite|oi+|opa|sim|não|nao|ah|ata|tá|ta|certo)[!.? ]*$/i;
  const MAX_MSGS = 150; // por conversa, no período
  const CONTEXT = 8; // de antes do período, só para entender
  const MAX_CHARS = 600;

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const textOf = (m) => {
    if (m.revoked) return "";
    if (m.type === "audio") return m.audio?.transcript ? `(áudio) ${m.audio.transcript}` : "";
    const t = String(m.textPt && m.fromMe ? m.textPt : m.translatedText || m.text || "").trim();
    if (m.type === "other") return t ? `(${(m.label || "mídia").toLowerCase()}) ${t}` : m.filename ? `(documento) ${m.filename}` : "";
    return t;
  };

  // me: "5511…@c.us" (a conta conectada)
  function prepare(chat, messages, { since, me } = {}) {
    const myPhone = String(me || "").split("@")[0];
    const sorted = [...messages].sort((a, b) => a.ts - b.ts);
    const inWindow = sorted.filter((m) => m.ts > since);
    const before = sorted.filter((m) => m.ts <= since).slice(-CONTEXT);
    let skippedAudio = 0;
    let skippedMedia = 0;
    const lines = [];
    const index = new Map(); // número → mensagem
    const pick = (m, context) => {
      const t = textOf(m);
      if (!t) {
        if (!context && !m.fromMe) m.type === "audio" ? skippedAudio++ : m.type === "other" && skippedMedia++;
        return;
      }
      if (!context && NOISE.test(t)) return;
      const n = index.size + 1;
      const mentionsMe = Boolean(myPhone && (m.mentions || []).some((x) => String(x.id || "").startsWith(`${myPhone}@`) || x.phone === myPhone));
      const repliesMe = Boolean(m.quoted?.fromMe);
      const who = m.fromMe ? "VOCÊ" : m.authorName || (chat.isGroup ? m.authorPhone || "Participante" : chat.name || "Contato");
      const flags = [context ? "contexto" : "", mentionsMe ? "te marcou" : "", repliesMe ? "respondendo você" : ""].filter(Boolean);
      index.set(n, { ...m, _text: t, _who: who, mentionsMe, repliesMe, context });
      lines.push(`[${n}] ${stamp(m.ts)} ${who}${flags.length ? ` (${flags.join(", ")})` : ""}: ${t.slice(0, MAX_CHARS).replace(/\n+/g, " / ")}`);
    };
    before.forEach((m) => pick(m, true));
    inWindow.slice(-MAX_MSGS).forEach((m) => pick(m, false));
    const fresh = [...index.values()].filter((m) => !m.context);
    return { lines, index, count: fresh.length, fromOthers: fresh.filter((m) => !m.fromMe).length, skippedAudio, skippedMedia, lastMine: Math.max(0, ...sorted.filter((m) => m.fromMe).map((m) => m.ts)) };
  }

  function buildPrompt(chat, prep, { now = Date.now(), myName = "" } = {}) {
    const d = new Date(now);
    const system = `Você organiza o WhatsApp de uma pessoa ocupada que não lê as conversas${myName ? ` (${myName})` : ""}. Nas mensagens, "VOCÊ" é ela.
Hoje é ${d.toLocaleDateString("pt-BR", { weekday: "long" })}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}.
Leia a conversa e extraia SÓ o que importa para ela:
- "question": alguém perguntou algo a ela e espera resposta
- "request": alguém pediu que ela faça/envie algo
- "commitment": compromisso com data/hora (reunião, visita, entrega, ligação, evento)
- "deadline": prazo ou data limite
- "notice": aviso importante (principalmente em grupos)
- "decision": algo que foi decidido
- "link": link ou documento importante compartilhado
Regras:
- Cada item cita em "sources" os números [n] das mensagens de onde saiu. Nunca invente: sem fonte, sem item.
- Mensagens marcadas "contexto" são só para entender; não gere itens só a partir delas.
- Em grupos, ignore conversa social; guarde avisos, decisões, datas e o que for para ela (te marcou / respondendo você / pergunta direta).
- Datas relativas ("amanhã", "sexta") são relativas à data da mensagem que as contém. Se não tiver certeza da data, deixe "date": null e copie o trecho em "date_text".
- "text": uma frase curta em português, com o essencial (quem, o quê).
- "who": o nome de quem pediu/perguntou/avisou.
Responda SÓ com JSON: {"summary":"1 ou 2 frases sobre a conversa","priority":0-3,"items":[{"type":"...","text":"...","who":"...","sources":[1],"date":"AAAA-MM-DD"|null,"time":"HH:MM"|null,"date_text":"..."|null}]}
Sem nada relevante: {"summary":"...","priority":0,"items":[]}`;
    const user = `${chat.isGroup ? "Grupo" : "Conversa com"}: ${chat.name || "sem nome"}\n<mensagens>\n${prep.lines.join("\n")}\n</mensagens>`;
    return { system, user };
  }

  function parseJson(raw) {
    const s = String(raw || "");
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("A IA não devolveu o resumo no formato esperado.");
    return JSON.parse(s.slice(a, b + 1));
  }

  const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(`${d}T12:00:00`));
  const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");

  // Resultado da IA → itens com fontes reais (mensagens desta conversa).
  function parse(raw, chat, prep) {
    const obj = typeof raw === "string" ? parseJson(raw) : raw;
    const items = [];
    for (const it of Array.isArray(obj.items) ? obj.items : []) {
      if (!TYPES.includes(it?.type) || !String(it.text || "").trim()) continue;
      const src = [...new Set((Array.isArray(it.sources) ? it.sources : []).map(Number))].map((n) => prep.index.get(n)).filter(Boolean);
      if (!src.length || src.every((m) => m.context)) continue; // sem fonte (ou só contexto): descarta
      const last = Math.max(...src.map((m) => m.ts));
      const toMe = src.some((m) => !m.fromMe && (m.mentionsMe || m.repliesMe || !chat.isGroup));
      const answered = prep.lastMine > last; // você escreveu depois nesta conversa
      items.push({
        type: it.type,
        text: String(it.text).trim().slice(0, 300),
        who: String(it.who || src.find((m) => !m.fromMe)?._who || "").slice(0, 80),
        date: validDate(it.date) ? it.date : null,
        time: validDate(it.date) && validTime(it.time) ? it.time : null,
        dateText: it.date_text ? String(it.date_text).slice(0, 120) : null,
        needsReply: ["question", "request"].includes(it.type) && toMe && !answered,
        answered,
        chatId: chat.chatId,
        chatName: chat.name || "",
        isGroup: Boolean(chat.isGroup),
        ts: last,
        sources: src.map((m) => ({ id: m.id, ts: m.ts, who: m._who, text: m._text.slice(0, 220) })),
      });
    }
    return { chatId: chat.chatId, chatName: chat.name || "", isGroup: Boolean(chat.isGroup), summary: String(obj.summary || "").slice(0, 400), priority: Math.max(0, Math.min(3, Number(obj.priority) || 0)), items, count: prep.count, skippedAudio: prep.skippedAudio, skippedMedia: prep.skippedMedia };
  }

  // Junta as conversas: pendências (mais antigas primeiro), compromissos por data
  // (repetidos em várias conversas viram um), avisos/decisões e o resto.
  function merge(results) {
    const all = results.flatMap((r) => r.items);
    const pending = all.filter((i) => i.needsReply).sort((a, b) => a.ts - b.ts);
    const dated = [];
    for (const i of all.filter((x) => (x.type === "commitment" || x.type === "deadline") && !x.needsReply)) {
      const key = i.date && `${i.date} ${i.time || ""} ${i.text.toLowerCase().replace(/[^a-z0-9à-ú]+/g, " ").split(" ").slice(0, 4).join(" ")}`;
      const same = key && dated.find((d) => d._key === key);
      if (same) same.sources.push(...i.sources.filter((s) => !same.sources.some((x) => x.id === s.id)));
      else dated.push({ ...i, _key: key });
    }
    dated.sort((a, b) => (a.date || "9999") .localeCompare(b.date || "9999") || (a.time || "99").localeCompare(b.time || "99") || a.ts - b.ts);
    const notices = all.filter((i) => ["notice", "decision"].includes(i.type) && !i.needsReply).sort((a, b) => b.ts - a.ts);
    const links = all.filter((i) => i.type === "link" && !i.needsReply);
    const other = all.filter((i) => ["question", "request"].includes(i.type) && !i.needsReply).sort((a, b) => b.ts - a.ts);
    const chats = [...results].filter((r) => r.summary || r.items.length).sort((a, b) => b.priority - a.priority || b.items.length - a.items.length);
    return {
      pending,
      dated: dated.map(({ _key, ...i }) => i),
      notices,
      links,
      other,
      chats,
      totals: { chats: results.length, messages: results.reduce((a, r) => a + r.count, 0), skippedAudio: results.reduce((a, r) => a + r.skippedAudio, 0), skippedMedia: results.reduce((a, r) => a + r.skippedMedia, 0) },
    };
  }

  // Abertura de 2–3 frases, escrita só a partir dos itens já conferidos.
  function overviewPrompt(merged) {
    const pick = (list, n) => list.slice(0, n).map((i) => `- ${i.text}${i.date ? ` (${i.date}${i.time ? ` ${i.time}` : ""})` : ""} [${i.chatName}]`).join("\n");
    return {
      system: "Escreva em português, em 2 ou 3 frases curtas e diretas, o que a pessoa precisa saber e fazer primeiro, a partir SÓ dos itens abaixo. Sem inventar nada, sem listas, sem saudação.",
      user: `Precisam de resposta:\n${pick(merged.pending, 12) || "(nenhum)"}\n\nCompromissos e prazos:\n${pick(merged.dated, 12) || "(nenhum)"}\n\nAvisos e decisões:\n${pick(merged.notices, 8) || "(nenhum)"}`,
    };
  }

  // Uma conversa inteira: prepara, chama a IA e confere. complete({system,user}) → texto
  async function summarizeChat(chat, messages, { since, me, now, myName, complete }) {
    const prep = prepare(chat, messages, { since, me });
    if (!prep.count) return { chatId: chat.chatId, chatName: chat.name || "", isGroup: Boolean(chat.isGroup), summary: "", priority: 0, items: [], count: 0, skippedAudio: prep.skippedAudio, skippedMedia: prep.skippedMedia };
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return parse(await complete(buildPrompt(chat, prep, { now, myName })), chat, prep);
      } catch (e) {
        lastErr = e;
        if (e?.code && e.code !== "INVALID_OUTPUT") break; // erro do provedor: não adianta repetir aqui
      }
    }
    throw lastErr;
  }

  globalThis.OrbitaSummary = { prepare, buildPrompt, parse, merge, overviewPrompt, summarizeChat, NOISE, TYPES };
})();
