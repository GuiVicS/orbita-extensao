// E-mail marketing — cliente da API da Resend. Roda nas páginas da extensão
// (e nos testes do Node). Expõe globalThis.OrbitaResend.
//
// API (resend.com/docs, conferida em 09/2026). Modelo de marketing atual:
// contatos globais, segmentos e broadcasts.
//   GET    /domains                                   domínios da conta (status "verified")
//   GET    /contacts?limit=100&after=…                 contatos (com "unsubscribed")
//   POST   /contacts {email, first_name, last_name, segments:[{id}]}
//   PATCH  /contacts/{email} {first_name, last_name}
//   POST   /contacts/{email}/segments/{segment_id}    põe um contato existente no segmento
//   POST   /segments {name}                           → {id}
//   POST   /broadcasts {segment_id, from, subject, html, text, reply_to, name, send, scheduled_at}
//   POST   /emails {from, to, subject, html, text}      (envio de teste)
//   GET    /broadcasts/{id}                           → {status, sent_at, scheduled_at…}
//   DELETE /broadcasts/{id}                           (rascunho ou agendado)
// Limite padrão: 10 pedidos por segundo por conta (429 rate_limit_exceeded).
// A Resend hospeda a página de descadastro: {{{RESEND_UNSUBSCRIBE_URL}}}; quem se
// descadastra fica "unsubscribed" para todos os broadcasts.
(() => {
  "use strict";
  if (globalThis.OrbitaResend) return;

  const BASE = "https://api.resend.com";
  const TIMEOUT_MS = 30000;

  class ResendError extends Error {
    constructor(code, message, { status = 0, retryable = false } = {}) {
      super(message);
      this.name = "ResendError";
      this.code = code;
      this.status = status;
      this.retryable = retryable;
    }
  }

  // Mensagens em português para os erros documentados da Resend.
  function toError(status, body) {
    const name = String(body?.name || body?.error?.name || "");
    const raw = String(body?.message || body?.error?.message || "");
    const MAP = {
      missing_api_key: ["AUTH", "Informe a chave da API da Resend."],
      invalid_api_key: ["AUTH", "Chave da Resend inválida."],
      restricted_api_key: ["AUTH", "Esta chave da Resend só pode enviar e-mails. Crie uma chave com acesso total (Full access) para usar o e-mail marketing."],
      suspended_api_key: ["AUTH", "Esta chave da Resend está suspensa."],
      invalid_permission: ["AUTH", "A chave da Resend não tem permissão para esta ação (use uma chave com acesso total)."],
      daily_quota_exceeded: ["QUOTA", "A cota diária de e-mails da sua conta Resend acabou. Tente amanhã ou mude de plano."],
      monthly_quota_exceeded: ["QUOTA", "A cota mensal de e-mails da sua conta Resend acabou. Mude de plano em resend.com para continuar."],
      email_above_quota: ["QUOTA", "Sua conta Resend passou da cota de envios."],
      rate_limit_exceeded: ["RATE_LIMIT", "Muitos pedidos à Resend ao mesmo tempo. Tentando de novo…"],
      not_found: ["NOT_FOUND", "Não encontrado na Resend."],
      resource_locked: ["RATE_LIMIT", "A Resend está atualizando este item. Tentando de novo…"],
    };
    if (MAP[name]) return new ResendError(MAP[name][0], MAP[name][1], { status, retryable: MAP[name][0] === "RATE_LIMIT" });
    if (status === 403 && /domain/i.test(raw)) return new ResendError("DOMAIN", `O domínio do remetente não está verificado na Resend (${raw}).`, { status });
    if (status === 401) return new ResendError("AUTH", "Chave da Resend inválida ou ausente.", { status });
    if (status === 429) return new ResendError("RATE_LIMIT", "Muitos pedidos à Resend. Tentando de novo…", { status, retryable: true });
    if (status >= 500) return new ResendError("PROVIDER", `A Resend está instável (HTTP ${status}).`, { status, retryable: true });
    return new ResendError(name === "validation_error" ? "VALIDATION" : "PROVIDER", `A Resend recusou o pedido${raw ? `: ${raw}` : ` (HTTP ${status}).`}`, { status });
  }

  // Um cliente por chave. opts.fetch / opts.sleep para testes.
  function client(apiKey, opts = {}) {
    const fetchImpl = opts.fetch || ((...a) => fetch(...a));
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const key = String(apiKey || "").trim();

    async function call(method, path, body) {
      if (!key) throw new ResendError("AUTH", "Informe a chave da API da Resend nas Opções → E-mail marketing.");
      for (let attempt = 0; ; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let r;
        try {
          r = await fetchImpl(`${BASE}${path}`, {
            method,
            headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal,
          });
        } catch (e) {
          if (attempt < 2) {
            await sleep(1000 * (attempt + 1));
            continue;
          }
          throw new ResendError(e?.name === "AbortError" ? "TIMEOUT" : "NETWORK", e?.name === "AbortError" ? "A Resend demorou demais para responder." : "Sem conexão com a Resend.", { retryable: true });
        } finally {
          clearTimeout(timer);
        }
        let json = null;
        try {
          json = await r.json();
        } catch {}
        if (r.ok) return json ?? {};
        const err = toError(r.status, json);
        if (err.retryable && attempt < 4) {
          await sleep(1100 * (attempt + 1)); // limite de pedidos: espera e tenta de novo
          continue;
        }
        throw err;
      }
    }

    const enc = encodeURIComponent;
    return {
      domains: async () => (await call("GET", "/domains")).data || [],
      // todos os contatos (paginado de 100 em 100)
      async contacts({ max = 100000 } = {}) {
        const out = [];
        let after = "";
        for (;;) {
          const page = await call("GET", `/contacts?limit=100${after ? `&after=${enc(after)}` : ""}`);
          out.push(...(page.data || []));
          if (!page.has_more || !page.data?.length || out.length >= max) return out;
          after = page.data.at(-1).id;
        }
      },
      createSegment: (name) => call("POST", "/segments", { name }),
      // cria o contato já no segmento; se ele já existe, atualiza o nome e põe no segmento
      async addContact({ email, firstName, lastName }, segmentId) {
        const names = { ...(firstName ? { first_name: firstName } : {}), ...(lastName ? { last_name: lastName } : {}) };
        try {
          return await call("POST", "/contacts", { email, ...names, segments: [{ id: segmentId }] });
        } catch (e) {
          if (!["VALIDATION", "PROVIDER"].includes(e.code) || !(e.status === 409 || e.status === 422 || /exist/i.test(e.message))) throw e;
          if (Object.keys(names).length) await call("PATCH", `/contacts/${enc(email)}`, names).catch(() => {});
          return call("POST", `/contacts/${enc(email)}/segments/${enc(segmentId)}`);
        }
      },
      createBroadcast: (b) =>
        call("POST", "/broadcasts", {
          segment_id: b.segmentId,
          from: b.from,
          subject: b.subject,
          html: b.html,
          text: b.text,
          ...(b.replyTo ? { reply_to: b.replyTo } : {}),
          name: b.name,
          send: true,
          ...(b.scheduledAt ? { scheduled_at: new Date(b.scheduledAt).toISOString() } : {}),
        }),
      // envio de teste para um endereço só (e-mail comum, fora dos broadcasts)
      sendTest: (m) => call("POST", "/emails", { from: m.from, to: [m.to], subject: `[Teste] ${m.subject}`, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
      broadcast: (id) => call("GET", `/broadcasts/${enc(id)}`),
      deleteBroadcast: (id) => call("DELETE", `/broadcasts/${enc(id)}`),
    };
  }

  globalThis.OrbitaResend = { client, ResendError, toError, BASE };
})();
