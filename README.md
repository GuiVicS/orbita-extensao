# Órbita — build da extensão (com correções)

Build da extensão Órbita (Chrome MV3) para campanhas no WhatsApp Web, com correções aplicadas diretamente nos arquivos minificados.

> ⚠️ As correções foram feitas **no build**, não no código-fonte. Um novo build a partir do fonte as desfaz — replique-as no fonte (detalhes abaixo e em `patches/`).

## Instalar

1. `chrome://extensions` → ativar **Modo do desenvolvedor**
2. **Carregar sem compactação** → selecionar esta pasta
3. Abrir/recarregar a aba do WhatsApp Web

## Correções aplicadas

| Patch | Arquivo | Problema | Correção |
|---|---|---|---|
| `0-midia.json` | `js/wa-js.js` | Imagem/vídeo enviados como mensagem "crua" com o arquivo inteiro em `body` → miniatura inválida (`data:image/jpeg;base64,data:video/mp4…`), mídia não chegava | `sendMedia` usa direto `WPP.chat.sendFileMessage` |
| `1-texto.json` | `js/wa-js.js` | Texto enviado via `sendRawMessage` (mensagem montada manualmente) | `sendText` usa `WPP.chat.sendTextMessage` como caminho principal; raw só se a função não existir |
| `2-consultas.json` | `js/wa-js.js` | Até 4 consultas `queryExists` por contato (op `resolve` sem cache + `sendText` de novo, ×2 variantes do 9º dígito) | Checa chat local antes de consultar o servidor; `resolve` usa o mesmo cache (10 min) do envio |
| `3-4-service-worker.json` | `js/service_worker.js` | Número sem WhatsApp reduzia o intervalo para 2–4 s; sem pausa por lote; sem limite diário | Intervalo normal sempre; padrão pausa de 10 min a cada 25 envios; limite diário global de 250 contatos (`settings.dailyLimit`, contador em `chrome.storage.local["orbita:dailySent"]`), retomando no dia seguinte |
| `4-ui-defaults.json` | `js/dashboard.js`, `js/popup.js` | Padrão da UI com `batchSize: 0` | Padrão `batchSize: 25`, `batchPauseMin: 10` |

### Reaplicar num build novo

```sh
node patches/patch.mjs js/wa-js.js patches/0-midia.json
node patches/patch.mjs js/wa-js.js patches/1-texto.json
node patches/patch.mjs js/wa-js.js patches/2-consultas.json
node patches/patch.mjs js/service_worker.js patches/3-4-service-worker.json
node patches/patch.mjs js/dashboard.js patches/4-ui-defaults.json
node patches/patch.mjs js/popup.js patches/4-ui-defaults.json
```

O script só aplica se cada trecho aparecer exatamente uma vez e valida a sintaxe antes de gravar. Como os nomes minificados mudam a cada build, o ideal é portar as mudanças para o código-fonte.

## Pendências (precisam do código-fonte)

- Expor o limite diário na tela de configurações
- Registro de consentimento (opt-in) por contato
- Descadastro automático ("SAIR")
- Aviso ao usuário sobre risco de banimento / Termos do WhatsApp
