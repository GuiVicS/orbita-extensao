# Órbita — build da extensão

Build da extensão Órbita (Chrome MV3) para campanhas no WhatsApp Web.

> A partir da **1.2.0** este build é gerado a partir do código-fonte (`npm run build`), que já inclui todas as correções abaixo. A pasta `patches/` fica só como histórico das correções feitas antes no build minificado — não reaplique.

## Novidades da 1.7.0

- **Respostas rápidas no WhatsApp Web**: barra logo abaixo do campo de mensagem com botões de respostas prontas, filtro por categoria, busca e prévia ao passar o mouse (botão direito também abre a prévia).
  - Cada resposta é uma **sequência de mensagens**: texto, **áudio enviado como gravado na hora** (mensagem de voz com forma de onda; o arquivo é convertido para OGG/Opus), áudio como arquivo, foto (HD / visualização única), vídeo (GIF, **vídeo redondo**, visualização única), documento, figurinha, localização, contato e enquete — com espera configurável entre elas.
  - **“Digitando…” / “gravando áudio…”** antes de cada envio (opcional), variáveis `{{saudacao}}`, `{{nome}}`, `{{primeiro_nome}}`, `{{telefone}}`, `{{data}}`, `{{hora}}`, `{{dia_semana}}`, `{{meu_nome}}` (com valor padrão: `{{primeiro_nome|tudo bem}}`).
  - Atalhos: digite **/atalho** no campo (Enter/Tab envia, Shift+Enter põe o texto no campo), **Alt+1…9** e Shift+clique para colocar o texto no campo sem enviar.
  - Gerenciadas no painel em **Respostas rápidas**: editor com prévia estilo WhatsApp, gravação pelo microfone, arrastar e soltar arquivos, colar imagens, categorias com cores, favoritas, contagem de uso, reordenar arrastando, importar/exportar e preferências.
- **Backup em Configurações**: “Baixar backup” gera um arquivo com listas, contatos, campanhas, mídias, histórico, CRM, agenda, preferências e respostas rápidas; “Restaurar backup” substitui os dados atuais pelos do arquivo. As chaves de API da IA não entram no backup (e as atuais são mantidas ao restaurar).
- O service worker agora é `js/background.js`, que carrega o `js/service_worker.js` original e acrescenta os handlers novos.

## Novidades da 1.6.0

- **Provedores de IA configuráveis**: Groq, OpenAI, Anthropic (Claude), Gemini, OpenRouter e servidores compatíveis com OpenAI (Ollama, LM Studio ou servidor próprio).
- **Transcrição de áudio**: configuração para Whisper via Groq ou OpenAI.
- **Fallback de modelo**: quando o modelo escolhido é aposentado, a Órbita escolhe outro modelo disponível.

## Novidades da 1.5.0

- **Assistente de IA no CRM**: no card do cliente, "Sugerir próxima ação" traz resumo, próxima ação e mensagem sugerida (usa o provedor configurado; o contexto do cliente e trechos da conversa são enviados para ele).
- **Resposta automática (modo seguro)**, desligada por padrão: liga geral + por cliente, só texto, horário/dias, espera de 1–3 min, máximo por cliente/dia, palavras de alerta, bloqueio de preços/percentuais inventados, "precisa de atenção" com notificação e desligamento automático quando você responde pelo WhatsApp. Aumenta o risco de bloqueio do número — use com poucos clientes.

## Novidades da 1.4.0

- **Disparo pelo CRM**: selecione cards (ou a coluna inteira) e "Disparar mensagem" — cria uma campanha só com esses clientes para revisar e iniciar, com o mesmo ritmo, pausas e limite diário.
- **Mensagens salvas** reutilizáveis nos disparos.
- Card do cliente: **Enviar mensagem** (avulsa, registrada no histórico) e **Abrir conversa no WhatsApp** na aba já aberta.
- Envios de campanha aparecem como "Mensagem" no histórico do cliente no CRM.
- Campanhas: **filtro de público sempre visível** e opção **"Todos os contatos (todas as listas)"**.

## Novidades da 1.3.0

- **Módulo Agenda** (desligado por padrão): compromissos e follow-ups sempre vinculados a um cliente, visões Lista / Semana / Mês e lembrete por notificação do sistema. Integrado ao CRM ("Agendar" e próximos compromissos no card do cliente).
- **Filtro de público nas campanhas**: etapa do funil, tags, variáveis da lista, campanhas anteriores, última interação e agenda, com contagem ao vivo.
- **Tags** nos clientes do CRM.
- **Importar contatos do WhatsApp**: aba "Do WhatsApp" em Contatos → Importar (agenda sincronizada e conversas, sem consultar o servidor).
- Nova permissão: `notifications` (lembretes da Agenda). Banco local atualizado para a versão 3; dados existentes são mantidos.

## Novidades da 1.2.0

- **Módulo CRM** (desligado por padrão): funil de vendas em Kanban com os clientes das listas de contatos — colunas editáveis, arrastar e soltar, histórico e notas por cliente. Ative em **Opções da extensão → Módulos**.
- Banco local (IndexedDB) atualizado para a versão 2; listas, campanhas e histórico existentes são mantidos.

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
| `6-respostas-rapidas-backup.json` | `js/dashboard.js` | Sem página de respostas rápidas nem backup | Item “Respostas rápidas” no menu (página `quick-replies.html` em iframe) e botões “Baixar backup” / “Restaurar backup” em Configurações (`js/backup.js`) |
| `5-ia-groq.json` | `js/service_worker.js` | Todos os contatos recebiam o mesmo texto | Antes de cada envio o texto (ou legenda) é parafraseado pela API do Groq. Configuração em `chrome.storage.local["orbita:ai"]`, editada em `options.html` / `js/ia-options.js`. Qualquer falha, demora acima de 20 s ou alteração em `{{variáveis}}`/links → envia o texto original |

## Variações com IA

`chrome://extensions` → Órbita → **Detalhes** → **Opções da extensão** (ou clique com o botão direito no ícone → **Opções**). Escolha o provedor, informe a chave ou o endereço do servidor compatível com OpenAI, ative e use **Gerar variação** para testar. As chaves ficam salvas somente neste navegador. Com a opção ligada, o texto de cada mensagem é enviado ao provedor configurado antes do disparo.

### Reaplicar num build novo

```sh
node patches/patch.mjs js/wa-js.js patches/0-midia.json
node patches/patch.mjs js/wa-js.js patches/1-texto.json
node patches/patch.mjs js/wa-js.js patches/2-consultas.json
node patches/patch.mjs js/service_worker.js patches/3-4-service-worker.json
node patches/patch.mjs js/dashboard.js patches/4-ui-defaults.json
node patches/patch.mjs js/popup.js patches/4-ui-defaults.json
node patches/patch.mjs js/service_worker.js patches/5-ia-groq.json
node patches/patch.mjs js/dashboard.js patches/6-respostas-rapidas-backup.json
```

`options.html`, `js/ia-options.js` e as entradas `options_ui` / `https://api.groq.com/*` do `manifest.json` não são patches: copie-os para o build novo.

O script só aplica se cada trecho aparecer exatamente uma vez e valida a sintaxe antes de gravar. Como os nomes minificados mudam a cada build, o ideal é portar as mudanças para o código-fonte.

## Pendências (precisam do código-fonte)

- Expor o limite diário na tela de configurações
- Registro de consentimento (opt-in) por contato
- Descadastro automático ("SAIR")
- Aviso ao usuário sobre risco de banimento / Termos do WhatsApp

## Atualizador para Windows

O atualizador portable do Orbita está na pasta [`updater/`](updater/). Consulte o [README do atualizador](updater/README.md) para executar, gerar o `.exe` e understand o fluxo de atualização. Os arquivos dessa pasta são excluídos do ZIP da extensão.
