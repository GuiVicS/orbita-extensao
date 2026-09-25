// Resumo do WhatsApp — página (resumo.html, em iframe na rota #/resumo do painel).
//
// "Gerar resumo": lista as conversas e grupos com mensagens desde o último
// resumo (menos os grupos excluídos), resume cada uma no service worker
// (OPS.SUMMARY_CHAT: IA + fontes conferidas), junta tudo (OrbitaSummary.merge),
// escreve a abertura (OPS.SUMMARY_OVERVIEW) e guarda. Cada item mostra a fonte
// (conversa, quem, hora, trecho) e abre a conversa na mensagem exata.
//   orbita:summary:last      fim do último resumo (ms) — "desde o último resumo"
//   orbita:summary:history   últimos 10 resumos
//   orbita:summary:excluded  conversas/grupos que ficam de fora
//   orbita:summary:resolved  itens marcados como resolvidos
(() => {
  "use strict";
  const C = globalThis.OrbitaChat;
  const SUM = globalThis.OrbitaSummary;
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const EMBED = params.has("embed");
  if (EMBED) document.body.classList.add("embed");
  const K = { last: "orbita:summary:last", history: "orbita:summary:history", excluded: "orbita:summary:excluded", resolved: "orbita:summary:resolved", ai: "orbita:summary:ai" };
  const AI_LABELS = { groq: "Groq", openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", openrouter: "OpenRouter", opencode: "OpenCode Zen", custom: "servidor próprio" };
  const PERIODS = { last: "Desde o último resumo", "24h": "Últimas 24 horas", "3d": "Últimos 3 dias", "7d": "Últimos 7 dias" };
  const H = 3600000;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nf = new Intl.NumberFormat("pt-BR");
  const when = (ts) => new Date(ts).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const hm = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const day = (ts) => new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return `há ${Math.max(1, m)} min`;
    if (m < 1440) return `há ${Math.round(m / 60)} h`;
    return `há ${Math.round(m / 1440)} dia${m >= 2880 ? "s" : ""}`;
  }
  const get = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
  const set = (k, v) => chrome.storage.local.set({ [k]: v });
  const call = async (op, extra = {}) => {
    const r = await chrome.runtime.sendMessage({ channel: C.CHANNEL, op, ...extra });
    if (!r) throw new Error("A extensão não respondeu. Recarregue a página.");
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  const itemKey = (i) => `${i.type}:${i.sources[0]?.id}`;
  const ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3"/><path d="M18.4 5.6l-2.1 2.1"/><path d="M21 12h-3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M3 12h3"/><rect x="7" y="12" width="10" height="9" rx="2"/></svg>';

  const S = { ai: { engine: "default" }, global: {}, period: "last", running: false, cancel: false, progress: null, current: null, history: [], excluded: [], resolved: {}, last: 0, groups: null, showExcl: false, showResolved: false };

  function confirmBox(title, text, ok) {
    return new Promise((resolve) => {
      const w = document.createElement("div");
      w.className = "modal";
      w.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p>
        <div class="actions"><span class="grow"></span><button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="yes">${esc(ok)}</button></div></div>`;
      document.body.append(w);
      w.querySelector('[data-x="no"]').focus();
      w.addEventListener("click", (e) => {
        const a = e.target.closest("[data-x]")?.dataset.x;
        if (a || e.target === w) (w.remove(), resolve(a === "yes"));
      });
      w.addEventListener("keydown", (e) => e.key === "Escape" && (w.remove(), resolve(false)));
    });
  }

  function toast(text, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), kind === "err" ? 7000 : 3500);
  }

  function sinceFor(period) {
    if (period === "last") return S.last || Date.now() - 24 * H; // primeira vez: últimas 24 h
    return Date.now() - { "24h": 24, "3d": 72, "7d": 168 }[period] * H;
  }

  // Abre a conversa na mensagem da fonte (no painel, pela rota das Conversas).
  function openSource(chatId, msgId) {
    const q = `chat=${encodeURIComponent(chatId)}${msgId ? `&msg=${encodeURIComponent(msgId)}` : ""}`;
    if (EMBED) parent.location.hash = `#/conversas?${q}`;
    else location.href = `conversas.html?${q}`;
  }

  // Compromisso → arquivo .ics (Google Agenda, Outlook, celular).
  function ics(i) {
    const p = (n) => String(n).padStart(2, "0");
    const d = i.date.replace(/-/g, "");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const txt = (s) => String(s).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
    let start = `DTSTART;VALUE=DATE:${d}`;
    let end = "";
    if (i.time) {
      const [h, m] = i.time.split(":").map(Number);
      start = `DTSTART:${d}T${p(h)}${p(m)}00`;
      end = `DTEND:${d}T${p((h + 1) % 24)}${p(m)}00`;
    }
    const src = i.sources.map((s) => `${s.who} (${when(s.ts)}): ${s.text}`).join("\n");
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbita//Resumo//PT", "BEGIN:VEVENT", `UID:${itemKey(i).replace(/[^\w.-]/g, "")}@orbita`, `DTSTAMP:${stamp}`, start, end, `SUMMARY:${txt(i.text)}`, `DESCRIPTION:${txt(`${i.chatName}\n${src}`)}`, "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
    a.download = `${i.text.slice(0, 40).replace(/[^\w\-à-ú ]+/gi, "").trim() || "compromisso"}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ------------------------------------------------------------ gerar
  async function generate() {
    if (S.running) return;
    if (S.ai.engine === "opencode" && !String(S.global.keys?.opencode || "").trim()) return toast("Falta a chave do OpenCode: configure em Opções → OpenCode Zen (Nemotron).", "err");
    const since = sinceFor(S.period);
    const until = Date.now();
    Object.assign(S, { running: true, cancel: false, progress: { done: 0, total: 0, label: "Buscando conversas com mensagens novas…" } });
    render();
    const results = [];
    const failed = [];
    try {
      // o WhatsApp Web pode estar terminando de carregar: espera um pouco antes de desistir
      let chats;
      for (let attempt = 0; ; attempt++) {
        try {
          chats = await call(C.OPS.SUMMARY_CHATS, { since, excluded: S.excluded });
          break;
        } catch (e) {
          if (attempt >= 7 || !/Abra o WhatsApp|carregando/i.test(e.message) || S.cancel) throw e;
          S.progress.label = "Esperando o WhatsApp Web carregar…";
          render();
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      S.progress.total = chats.length;
      // até 2 conversas ao mesmo tempo
      let next = 0;
      const worker = async () => {
        while (next < chats.length && !S.cancel) {
          const c = chats[next++];
          try {
            results.push(await call(C.OPS.SUMMARY_CHAT, { chatId: c.chatId, name: c.name, isGroup: c.isGroup, since, transcribe: S.ai.transcribe !== false, maxAudioSec: S.ai.maxAudioSec || 300 }));
          } catch (e) {
            failed.push({ chatId: c.chatId, name: c.name, error: e.message });
            if (/chave|Configure|inválida|créditos|cota|limite/i.test(e.message) && failed.length >= 2) S.cancel = true; // problema do provedor: para logo
          }
          S.progress.done++;
          S.progress.label = `Lendo ${nf.format(S.progress.done)} de ${nf.format(chats.length)} conversas…`;
          render();
        }
      };
      await Promise.all([worker(), worker()]);
      if (S.cancel && !results.length) throw new Error(failed[0]?.error || "Resumo cancelado.");
      const merged = SUM.merge(results);
      let overview = "";
      if (merged.pending.length || merged.dated.length || merged.notices.length) {
        S.progress.label = "Escrevendo a abertura…";
        render();
        overview = await call(C.OPS.SUMMARY_OVERVIEW, { merged }).catch(() => "");
      }
      const summary = { id: String(until), at: until, since, period: S.period, overview, merged, failed, partial: S.cancel };
      S.history = [summary, ...S.history].slice(0, 10);
      await set(K.history, S.history);
      // "desde o último resumo" só avança quando o resumo terminou inteiro
      if (!S.cancel && !failed.length) await set(K.last, until), (S.last = until);
      S.current = summary;
      if (failed.length) toast(`${failed.length} ${failed.length === 1 ? "conversa não foi resumida" : "conversas não foram resumidas"}: ${failed[0].error}`, "err");
    } catch (e) {
      toast(e.message, "err");
    }
    S.running = false;
    S.progress = null;
    render();
  }

  // ------------------------------------------------------------ tela
  const sourceHtml = (i) =>
    i.sources
      .slice(0, 3)
      .map((s) => `<button type="button" class="src" data-open="${esc(i.chatId)}" data-msg="${esc(s.id)}" title="Abrir a conversa nesta mensagem"><em><b>${esc(i.isGroup ? `${i.chatName} · ${s.who}` : s.who)}</b> · ${esc(day(s.ts))} ${esc(hm(s.ts))}</em><span>“${esc(s.text)}”</span></button>`)
      .join("") + (i.sources.length > 3 ? `<small class="muted">+${i.sources.length - 3} mensagens</small>` : "");

  function itemHtml(i, { pending = false, dated = false } = {}) {
    const done = Boolean(S.resolved[itemKey(i)]);
    const whenTxt = dated ? (i.time ? i.time : "dia todo") : pending ? `${i.isGroup ? i.chatName : ""}${i.isGroup ? " · " : ""}${ago(i.ts)}` : "";
    return `<div class="it ${done ? "done" : ""}">
      <div class="it-top">${whenTxt ? `<span class="chip ${pending ? "err" : "info"}">${esc(whenTxt)}</span>` : ""}<b>${esc(i.text)}</b></div>
      ${i.dateText && !i.date ? `<small class="muted">Data citada: “${esc(i.dateText)}” (confira)</small>` : ""}
      <div class="srcs">${sourceHtml(i)}</div>
      <div class="actions">
        <button class="btn sm" data-open="${esc(i.chatId)}" data-msg="${esc(i.sources.at(-1)?.id || "")}">Abrir conversa</button>
        ${dated && i.date ? `<button class="btn sm" data-ics="${esc(itemKey(i))}">Adicionar ao calendário</button>` : ""}
        <span class="grow"></span><button class="btn sm ${done ? "" : "ghost"}" data-done="${esc(itemKey(i))}">${done ? "✓ Resolvido" : "Marcar resolvido"}</button>
      </div></div>`;
  }

  function section(title, list, opts = {}, empty = "") {
    const visible = S.showResolved ? list : list.filter((i) => !S.resolved[itemKey(i)]);
    const hidden = list.length - visible.length;
    if (!list.length && !empty) return "";
    return `<section class="card sec"><div class="row"><h2 style="flex:1">${title} <span class="muted">(${visible.length})</span></h2>${hidden ? `<small class="muted">${hidden} resolvido${hidden > 1 ? "s" : ""}</small>` : ""}</div>
      ${visible.length ? visible.map((i) => itemHtml(i, opts)).join("") : `<p class="muted small" style="margin:0">${list.length ? "Tudo resolvido. 🎉" : empty}</p>`}</section>`;
  }

  function datedHtml(list) {
    const visible = S.showResolved ? list : list.filter((i) => !S.resolved[itemKey(i)]);
    if (!list.length) return "";
    const groups = new Map();
    for (const i of visible) {
      const k = i.date || "sem-data";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const label = (k) => {
      if (k === "sem-data") return "Sem data definida";
      const t = new Date(`${k}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
      return t.charAt(0).toUpperCase() + t.slice(1);
    };
    return `<section class="card sec"><h2>📅 Compromissos e datas <span class="muted">(${visible.length})</span></h2>
      ${[...groups].map(([k, items]) => `<h3 class="dayh">${esc(label(k))}</h3>${items.map((i) => itemHtml(i, { dated: true })).join("")}`).join("") || `<p class="muted small" style="margin:0">Tudo resolvido. 🎉</p>`}</section>`;
  }

  function resultHtml(s) {
    const m = s.merged;
    const t = m.totals;
    const left = [t.skippedAudio && `${nf.format(t.skippedAudio)} áudio${t.skippedAudio > 1 ? "s" : ""} sem transcrição`, t.skippedMedia && `${nf.format(t.skippedMedia)} foto${t.skippedMedia > 1 ? "s" : ""}/mídia${t.skippedMedia > 1 ? "s" : ""} sem legenda`, s.failed?.length && `${s.failed.length} conversa${s.failed.length > 1 ? "s" : ""} com erro (${s.failed.map((f) => f.name).join(", ")})`].filter(Boolean);
    return `<div class="card sec head">
        <div class="row"><div style="flex:1"><h2 style="font-size:17px">Resumo de ${esc(when(s.at))}</h2><small class="muted">${esc(PERIODS[s.period] || "")} · desde ${esc(when(s.since))} · ${nf.format(t.chats)} conversas · ${nf.format(t.messages)} mensagens${s.partial ? " · <b>interrompido</b>" : ""}</small></div>
          <label class="row small" style="gap:6px"><input type="checkbox" data-a="showres" ${S.showResolved ? "checked" : ""}> Mostrar resolvidos</label>
          <button class="btn sm danger" data-a="del" ${S.running ? "disabled" : ""}>Apagar este resumo</button>${S.history.length > 1 ? `<button class="btn sm danger" data-a="delall" ${S.running ? "disabled" : ""}>Apagar todos</button>` : ""}</div>
        ${s.overview ? `<p class="overview">${esc(s.overview)}</p>` : !m.pending.length && !m.dated.length && !m.notices.length ? `<p class="overview">Nada que precise de você neste período. 😌</p>` : ""}
        <div class="count"><div><b>${m.pending.length}</b><small>precisam de resposta</small></div><div><b>${m.dated.length}</b><small>compromissos e datas</small></div><div><b>${m.notices.length}</b><small>avisos e decisões</small></div></div>
      </div>
      ${section("🔴 Precisam da sua resposta", m.pending, { pending: true }, "Ninguém esperando resposta sua.")}
      ${datedHtml(m.dated)}
      ${section("📢 Avisos e decisões", m.notices)}
      ${section("🔗 Links e documentos", m.links)}
      ${section("💬 Outras perguntas e pedidos (já respondidos ou não diretos a você)", m.other)}
      ${m.chats.length ? `<section class="card sec"><h2>Por conversa</h2>${m.chats.map((c) => `<details class="chatsum"><summary><b>${esc(c.chatName)}</b>${c.isGroup ? ` <span class="chip">grupo</span>` : ""} <small class="muted">${c.items.length} ite${c.items.length === 1 ? "m" : "ns"} · ${c.count} mensagens</small></summary><p>${esc(c.summary || "Sem resumo.")}</p><button class="btn sm" data-open="${esc(c.chatId)}">Abrir conversa</button></details>`).join("")}</section>` : ""}
      ${left.length ? `<p class="muted small">Ficou de fora: ${esc(left.join(" · "))}.</p>` : ""}`;
  }

  // IA do resumo: a mesma das Opções ou o OpenCode Zen com o Nemotron gratuito
  function aiHtml() {
    const g = S.global;
    const gName = g.provider ? `${AI_LABELS[g.provider] || g.provider}${g.models?.[g.provider] ? ` · ${g.models[g.provider]}` : ""}` : "não configurada";
    const oc = S.ai.engine === "opencode";
    const hasKey = Boolean(String(g.keys?.opencode || "").trim());
    return `<div class="row" style="align-items:flex-end">
        <label class="field" style="max-width:420px"><span>IA do resumo</span><select class="in" data-a="ai" ${S.running ? "disabled" : ""}>
          <option value="default" ${oc ? "" : "selected"}>Mesma das Opções (${esc(gName)})</option>
          <option value="opencode" ${oc ? "selected" : ""}>OpenCode Zen · nemotron-3-ultra-free (gratuito)</option></select></label>
        <button class="btn" data-a="opts">Opções de IA</button>
      </div>
      ${oc ? `<p class="${hasKey ? "muted " : ""}small" style="margin:0">${hasKey ? `Chave do OpenCode configurada · modelo ${esc(g.models?.opencode || "nemotron-3-ultra-free")}.` : `<b class="err">Falta a chave do OpenCode.</b> Configure em Opções → OpenCode Zen (Nemotron).`} O Nemotron gratuito é um endpoint de teste da NVIDIA, com termos próprios de uso de dados — as conversas do período são enviadas para ele.</p>` : ""}
      ${txHtml()}`;
  }

  // Áudios sem transcrição: transcreve antes de resumir (Whisper da Groq/OpenAI).
  function txHtml() {
    const on = S.ai.transcribe !== false;
    const whisper = ["groq", "openai"].filter((k) => String(S.global.keys?.[k] || (k === "groq" ? S.global.apiKey : "") || "").trim());
    return `<div class="row" style="gap:10px">
        <label class="row small" style="gap:6px"><input type="checkbox" data-a="tx" ${on ? "checked" : ""} ${S.running ? "disabled" : ""}> Transcrever os áudios que faltam, de até</label>
        <select class="in" data-a="txmax" style="width:auto;height:32px" ${on && !S.running ? "" : "disabled"}>${[60, 180, 300, 600, 900].map((v) => `<option value="${v}" ${v === (S.ai.maxAudioSec || 300) ? "selected" : ""}>${v / 60} min</option>`).join("")}</select>
      </div>
      ${on ? `<p class="muted small" style="margin:0">${whisper.length ? `Transcrição pelo Whisper (${whisper.map((k) => (k === "groq" ? "Groq" : "OpenAI")).join(" ou ")}) — fica salva e não é feita de novo. Áudios mais longos ficam em “Ficou de fora”.` : "<b>Para transcrever, configure uma chave da Groq ou da OpenAI</b> em Opções → Variações com IA (o Nemotron não transcreve áudio). Sem ela, os áudios ficam de fora."}</p>` : ""}`;
  }

  function exclHtml() {
    if (!S.showExcl) return "";
    const groups = S.groups;
    return `<div class="card sec"><div class="row"><h2 style="flex:1">Grupos que ficam fora do resumo</h2><button class="btn sm" data-a="exclclose">Fechar</button></div>
      ${groups === null ? `<p class="muted small">Carregando grupos…</p>` : groups.error ? `<p class="err small">${esc(groups.error)}</p>` : groups.length ? `<div class="checks">${groups.map((g) => `<label><input type="checkbox" data-excl="${esc(g.chatId)}" ${S.excluded.includes(g.chatId) ? "checked" : ""}> ${esc(g.name || "Grupo sem nome")}</label>`).join("")}</div>` : `<p class="muted small">Nenhum grupo encontrado.</p>`}
      <p class="muted small" style="margin:0">Marcados não são lidos nem enviados para a IA.</p></div>`;
  }

  function render() {
    const s = S.current;
    const since = sinceFor(S.period);
    const p = S.progress;
    app.innerHTML = `<div class="top"><div class="grow"><h1>Resumo do WhatsApp</h1><p>Perguntas para você, compromissos, avisos dos grupos — com a fonte de cada item.</p></div></div>
      <div class="card sec">
        <div class="row">
          <label class="field" style="max-width:260px"><span>Período</span><select class="in" data-a="period" ${S.running ? "disabled" : ""}>${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === S.period ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <div class="field" style="flex:2"><span>&nbsp;</span><small class="muted">Desde ${esc(when(since))}${S.period === "last" && !S.last ? " (primeiro resumo: últimas 24 h)" : ""} · conversas e grupos${S.excluded.length ? `, menos ${S.excluded.length} grupo${S.excluded.length > 1 ? "s" : ""}` : ""}</small></div>
        </div>
        <div class="actions">
          <button class="btn" data-a="excl" ${S.running ? "disabled" : ""}>Grupos excluídos (${S.excluded.length})</button>
          ${S.history.length > 1 ? `<select class="in" data-a="hist" style="max-width:260px"><option value="">Resumos anteriores…</option>${S.history.map((h) => `<option value="${esc(h.id)}" ${s?.id === h.id ? "selected" : ""}>${esc(when(h.at))}</option>`).join("")}</select>` : ""}
          <span class="grow"></span>
          ${S.running ? `<button class="btn" data-a="cancel">Cancelar</button>` : ""}<button class="btn primary" data-a="gen" ${S.running ? "disabled" : ""}>${S.running ? "Gerando…" : "Gerar resumo"}</button>
        </div>
        ${p ? `<div class="okbox">${esc(p.label)}</div><div class="progress"><i style="width:${p.total ? Math.round((p.done / p.total) * 100) : 5}%"></i></div>` : ""}
        ${aiHtml()}
        <p class="muted small" style="margin:0">As mensagens do período vão para a IA escolhida acima para serem resumidas. O WhatsApp Web precisa estar aberto numa aba.</p>
      </div>
      ${exclHtml()}
      ${s ? resultHtml(s) : S.running ? "" : `<div class="card empty"><div class="z">${ICON}</div><b>Nenhum resumo ainda</b><p>Clique em “Gerar resumo”: a Órbita lê as conversas e grupos desde o último resumo e organiza o que precisa de você — com a mensagem de origem de cada item.</p></div>`}`;
  }

  // ------------------------------------------------------------ eventos
  const findItem = (key) => {
    const m = S.current?.merged;
    return m && [...m.pending, ...m.dated, ...m.notices, ...m.links, ...m.other].find((i) => itemKey(i) === key);
  };
  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-a],[data-open],[data-done],[data-ics]");
    if (!t || t.tagName === "SELECT" || t.tagName === "INPUT") return;
    if (t.dataset.open) return openSource(t.dataset.open, t.dataset.msg);
    if (t.dataset.done) {
      const k = t.dataset.done;
      S.resolved[k] ? delete S.resolved[k] : (S.resolved[k] = Date.now());
      await set(K.resolved, S.resolved);
      return render();
    }
    if (t.dataset.ics) return ics(findItem(t.dataset.ics));
    switch (t.dataset.a) {
      case "gen":
        return generate();
      case "cancel":
        S.cancel = true;
        S.progress.label = "Cancelando…";
        return render();
      case "excl":
        S.showExcl = true;
        render();
        if (!S.groups || S.groups.error) {
          S.groups = null;
          render();
          S.groups = await call(C.OPS.GROUP_LIST).catch((err) => Object.assign([], { error: err.message }));
        }
        return render();
      case "exclclose":
        S.showExcl = false;
        return render();
      case "del": {
        if (!S.current || !(await confirmBox("Apagar este resumo?", `O resumo de ${when(S.current.at)} some da Órbita. As conversas não são apagadas, e o próximo “desde o último resumo” continua de onde parou.`, "Apagar"))) return;
        const gone = S.current;
        S.history = S.history.filter((h) => h.id !== gone.id);
        await set(K.history, S.history);
        S.current = S.history[0] || null;
        toast("Resumo apagado.", "ok");
        return render();
      }
      case "delall":
        if (!(await confirmBox("Apagar todos os resumos?", `Os ${S.history.length} resumos salvos somem da Órbita (as conversas não são apagadas). O próximo “desde o último resumo” continua de onde parou.`, "Apagar todos"))) return;
        S.history = [];
        S.current = null;
        await set(K.history, []);
        await set(K.resolved, (S.resolved = {}));
        toast("Resumos apagados.", "ok");
        return render();
      case "opts":
        return chrome.runtime.openOptionsPage();
    }
  });
  app.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.a === "period") (S.period = t.value), render();
    else if (t.dataset.a === "ai") (S.ai = { ...S.ai, engine: t.value }), await set(K.ai, S.ai), render();
    else if (t.dataset.a === "tx") (S.ai = { ...S.ai, transcribe: t.checked }), await set(K.ai, S.ai), render();
    else if (t.dataset.a === "txmax") (S.ai = { ...S.ai, maxAudioSec: Number(t.value) }), await set(K.ai, S.ai), render();
    else if (t.dataset.a === "hist" && t.value) (S.current = S.history.find((h) => h.id === t.value)), render();
    else if (t.dataset.a === "showres") (S.showResolved = t.checked), render();
    else if (t.dataset.excl) {
      S.excluded = t.checked ? [...new Set([...S.excluded, t.dataset.excl])] : S.excluded.filter((x) => x !== t.dataset.excl);
      await set(K.excluded, S.excluded);
      render();
    }
  });

  (async () => {
    [S.last, S.history, S.excluded, S.resolved, S.ai, S.global] = await Promise.all([get(K.last, 0), get(K.history, []), get(K.excluded, []), get(K.resolved, {}), get(K.ai, { engine: "default" }), get("orbita:ai", {})]);
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local" || S.running) return;
      if (ch["orbita:ai"]) S.global = ch["orbita:ai"].newValue || {};
      if (ch[K.ai]) S.ai = ch[K.ai].newValue || { engine: "default" };
      if (ch["orbita:ai"] || ch[K.ai]) render();
    });
    S.current = S.history[0] || null;
    render();
    if (params.has("gerar")) generate(); // veio do botão da Visão geral
  })();
})();
