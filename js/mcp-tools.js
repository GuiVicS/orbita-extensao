// Agente local (MCP) — catálogo das ferramentas e dos prompts.
// O mesmo arquivo é lido pelo service worker (importScripts) e pelo servidor
// local mcp/orbita-mcp.mjs (Node), então as ferramentas nunca ficam diferentes.
//
// level: "read"     ler dados (padrão ligado)
//        "organize" alterar CRM, listas, agenda, rascunhos (padrão ligado)
//        "send"     enviar mensagens pelo WhatsApp (padrão DESLIGADO; com confirmação)
// Expõe globalThis.OrbitaMcpTools = { TOOLS, PROMPTS, LEVELS, PROTOCOL_VERSION }.
(() => {
  "use strict";
  if (globalThis.OrbitaMcpTools) return;

  const str = (description, extra = {}) => ({ type: "string", description, ...extra });
  const int = (description, extra = {}) => ({ type: "integer", description, ...extra });
  const bool = (description) => ({ type: "boolean", description });
  const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
  const PHONE = str("Telefone só com dígitos e DDI, ex.: 5511999998888");
  const CHAT = str("Id da conversa (ex.: 5511999998888@c.us, ou …@g.us para grupos). Veja list_chats.");
  const WHEN = (d) => str(`${d} Data/hora ISO 8601 (ex.: 2026-09-30T14:00:00-03:00).`);
  const LEAD = obj({
    email: str("E-mail"),
    company: str("Empresa"),
    source: str("Origem (Instagram, Facebook, Google, Site, WhatsApp, Indicação, Evento, Loja física…)"),
    owner: str("Responsável"),
    status: str("Situação do lead", { enum: ["novo", "contato", "qualificado", "ganho", "perdido", "desqualificado"] }),
    temperature: str("Temperatura", { enum: ["frio", "morno", "quente"] }),
    product: str("Produto/serviço de interesse"),
    potentialValue: { type: "number", description: "Valor potencial (R$)" },
    notes: str("Observações da ficha"),
  });
  const DEAL = obj({
    value: { type: "number", description: "Valor do negócio (R$)" },
    expectedCloseAt: str("Previsão de fechamento AAAA-MM-DD"),
    probability: int("Probabilidade 0–100", { minimum: 0, maximum: 100 }),
    lostReason: str("Motivo da perda"),
  });

  const TOOLS = [
    // ------------------------------------------------------------ leitura
    { name: "orbita_status", level: "read", title: "Situação da Órbita", description: "Visão geral: WhatsApp conectado, conta, módulos ligados e totais (conversas, não lidas, aguardando resposta, leads por etapa, listas, compromissos de hoje, campanhas ativas). Comece por aqui.", inputSchema: obj({}) },
    {
      name: "list_chats", level: "read", title: "Listar conversas",
      description: "Conversas do WhatsApp salvas na Órbita, da mais recente para a mais antiga, com última mensagem, não lidas, tradução e vínculo com o CRM.",
      inputSchema: obj({ filter: str("Filtro (not_in_crm = contatos que ainda não são leads)", { enum: ["all", "unread", "awaiting_reply", "contacts", "groups", "not_in_crm"], default: "all" }), query: str("Busca por nome, telefone ou texto da última mensagem"), limit: int("Máximo (padrão 50, até 200)", { minimum: 1, maximum: 200 }) }),
    },
    {
      name: "get_messages", level: "read", title: "Ler mensagens de uma conversa",
      description: "Mensagens de uma conversa em ordem cronológica, em formato compacto: quem, quando, texto original, tradução, transcrição de áudio e mensagem respondida. Com o WhatsApp Web aberto, busca as mais recentes antes. Use para analisar a conversa.",
      inputSchema: obj({ chatId: CHAT, limit: int("Quantas (padrão 60, até 300)", { minimum: 1, maximum: 300 }), before: WHEN("Só mensagens anteriores a esta data (paginação)."), since: WHEN("Só mensagens a partir desta data.") }, ["chatId"]),
    },
    {
      name: "search_messages", level: "read", title: "Buscar nas mensagens",
      description: "Busca um texto em todas as mensagens salvas (texto, tradução e transcrição dos áudios). Útil para achar quem pediu orçamento, citou um produto etc.",
      inputSchema: obj({ query: str("Texto a procurar (sem diferenciar maiúsculas e acentos)"), chatId: CHAT, since: WHEN("A partir de."), limit: int("Máximo (padrão 50, até 200)", { minimum: 1, maximum: 200 }) }, ["query"]),
    },
    {
      name: "awaiting_reply", level: "read", title: "Conversas esperando resposta",
      description: "Conversas em que a última mensagem é do contato e ninguém respondeu há pelo menos N horas — as que precisam de atenção, da mais antiga para a mais nova.",
      inputSchema: obj({ hours: { type: "number", description: "Horas sem resposta (padrão 0 = qualquer)" }, includeGroups: bool("Incluir grupos (padrão não)"), limit: int("Máximo (padrão 50)", { minimum: 1, maximum: 200 }) }),
    },
    {
      name: "chat_metrics", level: "read", title: "Métricas do atendimento",
      description: "Números do WhatsApp num período: mensagens recebidas/enviadas, conversas ativas, tempo da primeira resposta (média e mediana), horários de pico, conversas mais movimentadas e as que esperam resposta.",
      inputSchema: obj({ since: WHEN("Início do período (padrão: 7 dias atrás)."), includeGroups: bool("Incluir grupos (padrão não)") }),
    },
    { name: "list_stages", level: "read", title: "Etapas do funil", description: "Etapas do CRM (Kanban) na ordem, com id, nome, cor e quantos leads há em cada uma.", inputSchema: obj({}) },
    {
      name: "list_leads", level: "read", title: "Listar leads do CRM",
      description: "Leads/clientes do CRM com nome, telefone, etapa, etiquetas, ficha (temperatura, situação, origem, valor) e última interação. Filtre para organizar o funil.",
      inputSchema: obj({
        stageId: str("Só desta etapa (id de list_stages)"), tag: str("Só com esta etiqueta"), query: str("Busca por nome, telefone, etiqueta, empresa ou e-mail"),
        temperature: str("Temperatura", { enum: ["frio", "morno", "quente"] }), status: str("Situação", { enum: ["novo", "contato", "qualificado", "ganho", "perdido", "desqualificado"] }),
        staleDays: int("Só sem interação (nota, atividade ou mensagem no WhatsApp) há pelo menos N dias; inclui quem nunca teve interação"), limit: int("Máximo (padrão 100, até 500)", { minimum: 1, maximum: 500 }), offset: int("Pular os N primeiros", { minimum: 0 }),
      }),
    },
    { name: "list_tags", level: "read", title: "Etiquetas do CRM", description: "Todas as etiquetas usadas nos leads, com quantos leads têm cada uma.", inputSchema: obj({}) },
    {
      name: "pipeline_report", level: "read", title: "Relatório do funil",
      description: "Saúde do funil: leads e valor (negócio e potencial) por etapa, temperatura, situação (ganhos/perdidos), leads parados (7/30 dias), sem ficha preenchida e etiquetas mais usadas.",
      inputSchema: obj({}),
    },
    { name: "get_lead", level: "read", title: "Ficha completa do lead", description: "Tudo sobre um lead: nome, listas, etapa, etiquetas, ficha, negócio, histórico (notas, atividades, mudanças de etapa), compromissos e a conversa do WhatsApp vinculada.", inputSchema: obj({ phone: PHONE }, ["phone"]) },
    { name: "list_lists", level: "read", title: "Listas de contatos", description: "Listas de contatos (importadas, do WhatsApp, de grupos) com id, nome, origem e quantidade.", inputSchema: obj({}) },
    { name: "get_list", level: "read", title: "Contatos de uma lista", description: "Contatos de uma lista (telefone, nome e variáveis).", inputSchema: obj({ listId: str("Id da lista"), limit: int("Máximo (padrão 200, até 1000)", { minimum: 1, maximum: 1000 }), offset: int("Pular", { minimum: 0 }) }, ["listId"]) },
    { name: "list_appointments", level: "read", title: "Agenda", description: "Compromissos da agenda num período (padrão: de hoje a 30 dias).", inputSchema: obj({ from: WHEN("Início."), to: WHEN("Fim."), status: str("Situação", { enum: ["scheduled", "done", "cancelled"] }), phone: PHONE }) },
    { name: "list_campaigns", level: "read", title: "Campanhas", description: "Campanhas de envio com situação e números (enviadas, falhas, na fila).", inputSchema: obj({ status: str("Filtrar por situação", { enum: ["DRAFT", "SCHEDULED", "RUNNING", "BLOCKED", "READY_TO_RESUME", "PAUSED", "COMPLETED", "CANCELLED"] }) }) },
    { name: "get_campaign", level: "read", title: "Detalhes da campanha", description: "Uma campanha: mensagens, ritmo, lista, números e os destinatários com falha.", inputSchema: obj({ campaignId: str("Id da campanha") }, ["campaignId"]) },
    { name: "list_quick_replies", level: "read", title: "Respostas rápidas", description: "Respostas rápidas cadastradas (atalho, título, categoria e passos).", inputSchema: obj({ query: str("Busca por atalho ou título") }) },
    { name: "get_last_summary", level: "read", title: "Último Resumo do WhatsApp", description: "O último resumo gerado (o que precisa de resposta, compromissos, avisos) e os anteriores, se pedir.", inputSchema: obj({ index: int("0 = o último, 1 = o anterior…", { minimum: 0, maximum: 9 }) }) },
    { name: "list_groups", level: "read", title: "Grupos do WhatsApp", description: "Todos os grupos da conta conectada (precisa do WhatsApp Web aberto).", inputSchema: obj({}) },
    { name: "get_group_members", level: "read", title: "Participantes do grupo", description: "Participantes de um grupo: nome, número e se é admin (precisa do WhatsApp Web aberto).", inputSchema: obj({ groupId: str("Id do grupo (…@g.us)") }, ["groupId"]) },
    { name: "transcribe_audio", level: "read", title: "Transcrever áudio", description: "Transcreve um áudio recebido (usa o Whisper configurado; gasta créditos do provedor). Devolve o texto.", inputSchema: obj({ messageId: str("Id da mensagem de áudio (de get_messages)") }, ["messageId"]) },

    // ------------------------------------------------------------ organizar
    {
      name: "update_lead", level: "organize", title: "Atualizar lead",
      description: "Muda etapa, etiquetas, nome, ficha e negócio de um lead (cria o lead se ainda não existir). Mudança de etapa fica registrada no histórico, como no painel.",
      inputSchema: obj({ phone: PHONE, name: str("Nome"), stageId: str("Id da etapa (list_stages)"), stageName: str("Ou o nome da etapa"), addTags: { type: "array", items: { type: "string" }, description: "Etiquetas a acrescentar" }, removeTags: { type: "array", items: { type: "string" }, description: "Etiquetas a tirar" }, lead: LEAD, deal: DEAL }, ["phone"]),
    },
    {
      name: "bulk_update_leads", level: "organize", title: "Atualizar vários leads",
      description: "Move vários leads de uma vez (para outra etapa) e/ou muda etiquetas, temperatura, situação e responsável — por uma lista de telefones ou por um filtro. Use dryRun para ver quem seria alterado antes. Máximo 1000 por vez.",
      inputSchema: obj({
        phones: { type: "array", maxItems: 1000, items: PHONE, description: "Telefones dos leads" },
        filter: obj({ stageId: str("Etapa atual"), tag: str("Com a etiqueta"), temperature: str("Temperatura", { enum: ["frio", "morno", "quente"] }), status: str("Situação", { enum: ["novo", "contato", "qualificado", "ganho", "perdido", "desqualificado"] }), staleDays: int("Sem interação há N dias"), query: str("Busca") }),
        set: obj({ stageId: str("Nova etapa (id)"), stageName: str("Ou o nome da nova etapa"), addTags: { type: "array", items: { type: "string" } }, removeTags: { type: "array", items: { type: "string" } }, temperature: str("Temperatura", { enum: ["frio", "morno", "quente"] }), status: str("Situação", { enum: ["novo", "contato", "qualificado", "ganho", "perdido", "desqualificado"] }), owner: str("Responsável") }),
        note: str("Nota a registrar em cada lead alterado (opcional)"),
        dryRun: bool("Só simular: mostra quem seria alterado, sem gravar"),
      }, ["set"]),
    },
    { name: "set_auto_reply", level: "organize", title: "IA responde este cliente", description: "Liga ou desliga a resposta automática da IA para um cliente (a regra geral fica nas configurações do painel).", inputSchema: obj({ phone: PHONE, enabled: bool("Ligada") }, ["phone", "enabled"]) },
    { name: "add_lead_note", level: "organize", title: "Anotar no lead", description: "Acrescenta uma nota ao histórico do lead (ex.: resumo da conversa, próximo passo).", inputSchema: obj({ phone: PHONE, text: str("Texto da nota") }, ["phone", "text"]) },
    {
      name: "log_activity", level: "organize", title: "Registrar atividade",
      description: "Registra uma atividade no lead (ligação, WhatsApp, e-mail, reunião, visita, tarefa) com resultado e próximo passo — aparece na ficha do lead.",
      inputSchema: obj({ phone: PHONE, type: str("Tipo", { enum: ["ligacao", "whatsapp", "email", "reuniao", "visita", "tarefa"] }), description: str("O que aconteceu"), result: str("Resultado (Sem resposta, Interessado, Pediu proposta, Agendou reunião, Fechou negócio, Sem interesse…)"), nextAction: str("Próximo passo"), nextAt: WHEN("Quando fazer o próximo passo."), owner: str("Responsável") }, ["phone", "type", "description"]),
    },
    { name: "create_stage", level: "organize", title: "Criar etapa do funil", description: "Cria uma etapa nova no final do funil do CRM.", inputSchema: obj({ name: str("Nome da etapa"), color: str("Cor #RRGGBB (opcional)") }, ["name"]) },
    {
      name: "create_appointment", level: "organize", title: "Agendar compromisso",
      description: "Cria um compromisso na Agenda da Órbita, com lembrete (notificação no computador e no celular, se configurado).",
      inputSchema: obj({ phone: PHONE, title: str("Título"), start: WHEN("Início."), durationMin: int("Duração em minutos (padrão 30)", { minimum: 5, maximum: 1440 }), reminderMin: { type: ["integer", "null"], description: "Lembrete N minutos antes (padrão 30; null = sem lembrete)" }, description: str("Detalhes") }, ["phone", "title", "start"]),
    },
    { name: "update_appointment", level: "organize", title: "Alterar compromisso", description: "Remarca, renomeia, conclui ou cancela um compromisso.", inputSchema: obj({ appointmentId: str("Id do compromisso"), start: WHEN("Novo início."), title: str("Novo título"), durationMin: int("Duração", { minimum: 5, maximum: 1440 }), status: str("Situação", { enum: ["scheduled", "done", "cancelled"] }), description: str("Detalhes") }, ["appointmentId"]) },
    {
      name: "create_list", level: "organize", title: "Criar lista de contatos",
      description: "Cria uma lista de contatos (ex.: leads quentes para uma campanha). Números repetidos entram uma vez.",
      inputSchema: obj({ name: str("Nome da lista"), contacts: { type: "array", maxItems: 5000, items: obj({ phone: PHONE, name: str("Nome"), vars: { type: "object", description: "Variáveis para as mensagens ({{variavel}})", additionalProperties: { type: "string" } } }, ["phone"]) } }, ["name", "contacts"]),
    },
    { name: "add_to_list", level: "organize", title: "Adicionar à lista", description: "Acrescenta contatos a uma lista existente (sem duplicar).", inputSchema: obj({ listId: str("Id da lista"), contacts: { type: "array", maxItems: 5000, items: obj({ phone: PHONE, name: str("Nome"), vars: { type: "object", additionalProperties: { type: "string" } } }, ["phone"]) } }, ["listId", "contacts"]) },
    {
      name: "create_campaign_draft", level: "organize", title: "Rascunho de campanha",
      description: "Cria uma campanha em RASCUNHO para uma lista, com as mensagens de texto ({{primeiro_nome}}, {{saudacao}} e variáveis da lista funcionam). Nada é enviado: você revisa e inicia no painel.",
      inputSchema: obj({ name: str("Nome da campanha"), listId: str("Id da lista"), messages: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" }, description: "Mensagens em sequência" } }, ["name", "listId", "messages"]),
    },
    { name: "set_chat_translation", level: "organize", title: "Tradução da conversa", description: "Liga/desliga a tradução automática de uma conversa e define o idioma do contato.", inputSchema: obj({ chatId: CHAT, enabled: bool("Ligada"), contactLang: str("Idioma do contato (ex.: en, es, fr; auto = detectar)") }, ["chatId", "enabled"]) },
    { name: "mark_chat_read", level: "organize", title: "Marcar como lida", description: "Zera o contador de não lidas de uma conversa na Órbita.", inputSchema: obj({ chatId: CHAT }, ["chatId"]) },

    // ------------------------------------------------------------ enviar (WhatsApp)
    {
      name: "send_message", level: "send", title: "Enviar mensagem no WhatsApp",
      description: "Envia uma mensagem de texto pelo WhatsApp Web. Se a conversa tiver tradução ligada, escreva em português: a Órbita traduz antes. Pode exigir sua confirmação no computador (Opções → Agente local).",
      inputSchema: obj({ chatId: CHAT, phone: PHONE, text: str("Texto (formatação do WhatsApp: *negrito*, _itálico_)"), replyTo: str("Id da mensagem a responder (opcional)") }, ["text"]),
    },
    { name: "send_quick_reply", level: "send", title: "Enviar resposta rápida", description: "Envia uma resposta rápida cadastrada (texto, áudio, mídia) numa conversa. Pode exigir confirmação.", inputSchema: obj({ chatId: CHAT, quickReplyId: str("Id da resposta rápida (list_quick_replies)") }, ["chatId", "quickReplyId"]) },
  ];

  const PROMPTS = [
    {
      name: "organizar_leads", title: "Organizar os leads", description: "Revisa o funil: classifica temperatura/situação, move de etapa e anota o motivo, a partir das conversas.",
      arguments: [{ name: "limite", description: "Quantos leads revisar (padrão 30)", required: false }],
      text: (a) => `Você é meu assistente comercial na Órbita. Organize meu CRM:
1. Chame orbita_status e list_stages para entender o funil.
2. Liste até ${a.limite || 30} leads com list_leads (priorize os sem temperatura/situação e os parados há mais tempo).
3. Para cada um, leia a conversa vinculada (get_lead → get_messages, últimas 40) e decida: etapa certa, temperatura (frio/morno/quente), situação e etiquetas úteis.
4. Aplique com update_lead e registre o motivo em 1–2 frases com add_lead_note.
5. No fim, me mostre uma tabela: lead, o que mudou e por quê — e os 5 que merecem contato hoje.
Não envie mensagens a ninguém.`,
    },
    {
      name: "analisar_conversas", title: "Analisar conversas", description: "Lê as conversas recentes e diz quem precisa de resposta, intenções de compra, objeções e próximos passos.",
      arguments: [{ name: "horas", description: "Janela em horas (padrão 24)", required: false }],
      text: (a) => `Analise minhas conversas do WhatsApp das últimas ${a.horas || 24} horas:
1. Use awaiting_reply e list_chats para achar as conversas relevantes; leia cada uma com get_messages (use since).
2. Para cada conversa: intenção (compra, dúvida, suporte, reclamação…), sentimento, objeções, valores/produtos citados e o próximo passo.
3. Atualize o CRM: add_lead_note com o resumo e update_lead (temperatura/etapa) quando ficar claro.
4. Me entregue: (a) quem responder primeiro e sugestão de resposta; (b) oportunidades quentes; (c) riscos (clientes insatisfeitos).
Não envie mensagens sem eu pedir.`,
    },
    {
      name: "follow_up", title: "Follow-up de leads parados", description: "Acha leads sem interação há N dias e prepara mensagens de retomada para você aprovar.",
      arguments: [{ name: "dias", description: "Dias sem interação (padrão 7)", required: false }],
      text: (a) => `Encontre leads sem interação há pelo menos ${a.dias || 7} dias (list_leads com staleDays) que não estejam perdidos/ganhos.
Para cada um, leia o fim da conversa (get_messages) e escreva uma mensagem de retomada curta, pessoal e natural, citando o último assunto.
Mostre a lista para eu aprovar. Só use send_message para os que eu aprovar explicitamente.`,
    },
    {
      name: "resumo_do_dia", title: "Resumo do dia", description: "Agenda de hoje, conversas pendentes, campanhas e prioridades.",
      arguments: [],
      text: () => `Monte meu resumo do dia na Órbita: orbita_status, list_appointments (hoje), awaiting_reply (mais de 2 horas), list_campaigns (ativas) e get_last_summary. Organize em: Agenda, Precisam de resposta (com sugestão curta de resposta), Campanhas, e 3 prioridades.`,
    },
    {
      name: "preparar_campanha", title: "Preparar campanha", description: "Monta uma lista segmentada e um rascunho de campanha (sem enviar).",
      arguments: [{ name: "objetivo", description: "Objetivo da campanha (ex.: promoção de primavera para leads quentes)", required: true }],
      text: (a) => `Objetivo: ${a.objetivo}.
1. Use list_leads/list_lists para escolher o público certo e explique o critério.
2. Crie a lista com create_list.
3. Escreva 1 a 3 mensagens curtas (use {{primeiro_nome}} e {{saudacao}}) e crie o rascunho com create_campaign_draft.
4. Me diga como revisar e iniciar no painel. Não envie nada.`,
    },
  ];

  PROMPTS.push(
    {
      name: "qualificar_novos_contatos", title: "Qualificar novos contatos", description: "Acha conversas de quem ainda não está no CRM, lê e cadastra como lead com etapa, ficha e nota.",
      arguments: [{ name: "limite", description: "Quantas conversas (padrão 20)", required: false }],
      text: (a) => `Use list_chats com filter "not_in_crm" (limite ${a.limite || 20}). Para cada conversa, leia com get_messages e decida se é um lead de verdade (ignore spam, fornecedores e pessoais — me diga quais ignorou).
Para os leads: update_lead (nome, etapa adequada de list_stages, ficha: origem "WhatsApp", produto de interesse, temperatura) e add_lead_note com o resumo e o próximo passo. Se houver data combinada, create_appointment.
No fim, uma tabela do que foi cadastrado. Não envie mensagens.`,
    },
    {
      name: "relatorio_semanal", title: "Relatório semanal", description: "Funil, atendimento e campanhas da semana, com recomendações.",
      arguments: [],
      text: () => `Monte meu relatório da semana: pipeline_report, chat_metrics (últimos 7 dias), list_campaigns e list_appointments (próximos 7 dias).
Mostre: números principais, gargalos do funil (onde os leads param), tempo de resposta e horários de pico, resultado das campanhas, e 5 recomendações práticas para a próxima semana.`,
    },
  );

  const LEVELS = {
    read: "Ler conversas, CRM, agenda, listas e campanhas",
    organize: "Organizar: alterar leads, etapas, notas, agenda, listas e rascunhos",
    send: "Enviar mensagens pelo WhatsApp",
  };

  globalThis.OrbitaMcpTools = { TOOLS, PROMPTS, LEVELS, PROTOCOL_VERSION: "2025-06-18" };
})();
