// Opções → "E-mail marketing (Resend)": chave (fora do backup), remetente e rodapé.
(() => {
  "use strict";
  const E = globalThis.OrbitaEmail;
  const R = globalThis.OrbitaResend;
  const $ = (id) => document.getElementById(id);
  if (!$("emailSec")) return;
  const FIELDS = { emFromName: "fromName", emFromEmail: "fromEmail", emReplyTo: "replyTo", emCompany: "company", emAddress: "address" };
  const status = (id, text, ok = true) => (($(id).textContent = text), ($(id).className = `status ${ok === null ? "" : ok ? "ok" : "err"}`));

  async function load() {
    const s = await E.loadSettings();
    for (const [id, k] of Object.entries(FIELDS)) $(id).value = s[k] || "";
    $("emKey").value = await E.apiKey();
  }

  $("emToggle").addEventListener("click", () => {
    const show = $("emKey").type === "password";
    $("emKey").type = show ? "text" : "password";
    $("emToggle").textContent = show ? "Ocultar" : "Mostrar";
  });

  // Testar: lista os domínios da conta e sugere os verificados no campo do remetente
  $("emTest").addEventListener("click", async () => {
    status("emKeyStatus", "Conferindo…", null);
    try {
      const doms = await R.client($("emKey").value).domains();
      const ok = doms.filter((d) => d.status === "verified").map((d) => d.name);
      $("emDomains").innerHTML = ok.map((d) => `<option value="contato@${d}">`).join("");
      status("emKeyStatus", ok.length ? `Chave válida. Domínios verificados: ${ok.join(", ")}.` : `Chave válida, mas nenhum domínio verificado ainda${doms.length ? ` (${doms.map((d) => `${d.name}: ${d.status}`).join(", ")})` : ""}. Verifique em resend.com/domains.`, ok.length > 0);
    } catch (e) {
      status("emKeyStatus", e.message, false);
    }
  });

  $("emSave").addEventListener("click", async () => {
    const patch = Object.fromEntries(Object.entries(FIELDS).map(([id, k]) => [k, $(id).value.trim()]));
    if (patch.fromEmail && !E.isEmail(patch.fromEmail)) return status("emStatus", "E-mail do remetente inválido.", false);
    if (patch.replyTo && !E.isEmail(patch.replyTo)) return status("emStatus", "E-mail de resposta inválido.", false);
    await E.saveSettings(patch);
    await E.setApiKey($("emKey").value);
    status("emStatus", "Configuração do e-mail salva.");
  });

  load();
})();
