# Órbita — build da extensão

Build da extensão Órbita (Chrome MV3) para campanhas no WhatsApp Web.

> A partir da **1.2.0** este build é gerado a partir do código-fonte (`npm run build`), que já inclui todas as correções abaixo. A pasta `patches/` fica só como histórico das correções feitas antes no build minificado — não reaplique.

## Novidades da 1.21.0

- **Órbita Cloud (Supabase).** Em **Opções → Órbita Cloud**, o botão **Habilitar Cloud** abre um assistente de 5 passos:
  1. **Conta no Supabase**: link para criar a conta (plano gratuito) ou **Já tenho conta**, com o passo a passo do projeto.
  2. **Project URL + chave publicável** (`sb_publishable_…` ou a `anon` antiga). A chave secreta/service_role é recusada: ela dá acesso total e o Supabase a bloqueia em navegadores. Projetos fora do `supabase.co` (self-hosted) pedem permissão para o endereço.
  3. **Usuário da Órbita Cloud** (e-mail e senha no Supabase Auth): **Entrar** ou **Criar usuário**, com aviso quando o projeto pede confirmação de e-mail. Cada registro fica preso ao usuário por RLS. Use o mesmo usuário em todos os computadores.
  4. **Tabela**: a extensão verifica se `orbita_records` já existe. Se não existir, **cria automaticamente** com um token pessoal (`sbp_…`, usado só nessa hora e **não guardado**). A alternativa manual é **Copiar SQL** e colar no SQL Editor do projeto (link direto), depois **Já rodei, conferir**. O SQL cria a tabela, o índice, o RLS, a política, os GRANTs e o gatilho de `updated_at`.
  5. **Primeira sincronização**. Se a nuvem está vazia, envia tudo. Se já tem dados, você escolhe:
     - **Mesclar** (padrão): une os dois lados; num conflito vale o registro editado por último.
     - **Usar os da nuvem**: substitui este computador.
     - **Enviar os deste computador**: substitui a nuvem.

     A opção **baixar um backup antes** vem marcada, e as opções que substituem dados pedem confirmação.
- **Sincronização automática** a cada 1, 5 (padrão), 15 ou 60 minutos, ou só no botão **Sincronizar agora**. Roda pelo service worker (alarme `orbita-cloud`), mesmo com as Opções fechadas.
  - Cada rodada baixa só o que mudou em outros computadores e envia só o que mudou aqui, incluindo remoções. Se o mesmo registro mudou aqui e lá, vale o daqui.
  - Uma trava impede duas sincronizações ao mesmo tempo.
  - Quando a sessão expira, as Opções pedem para entrar de novo.
- **O que sincroniza**: listas e contatos, CRM (clientes e etapas), agenda, campanhas e destinatários, Conversas (conversas, mensagens, figurinhas sem arquivo), respostas rápidas e preferências.
- **O que fica só neste computador**: as chaves de API (IA, Fish Audio, ElevenLabs, Resend), os arquivos (mídias e figurinhas, que continuam no backup) e o registro técnico.
- Tudo fica numa tabela genérica, `orbita_records` (`store`, `id`, `data jsonb`, `deleted`, `updated_at`), então dados novos da Órbita entram sem mudar o SQL.
- **Mais opções**: refazer a primeira sincronização; trocar de usuário ou projeto; **Desligar Cloud** (mantém a conexão); **Desconectar e esquecer**. Os dados na nuvem continuam no seu Supabase.
- O backup em arquivo não leva a conexão nem a sessão da Cloud, e restaurar um backup não desconecta a Cloud.

## Novidades da 1.20.1

- **Nemotron grátis pelo OpenRouter.** O plano gratuito do OpenCode Zen **só funciona dentro do app OpenCode** (a API responde 403 “FreeTierError” para outros programas). Por isso a seção **Opções → Nemotron (NVIDIA)** agora escolhe **por onde usar**: **OpenRouter — grátis (recomendado)**, com `nvidia/nemotron-3-ultra-550b-a55b:free` (chave em openrouter.ai/keys), ou OpenCode Zen (só com créditos pagos). Tem **Testar**, modelo e **“Usar no Resumo do WhatsApp”**; a chave de cada provedor é a mesma usada quando ele é o principal.
- **Erros de IA com o motivo real**: em vez de “chave inválida ou sem permissão”, aparece o que o provedor respondeu (ex.: a restrição do plano gratuito do OpenCode).

## Novidades da 1.20.0

- **OpenCode Zen como provedor de IA** (Opções → Variações com IA → **OpenCode Zen (Nemotron gratuito)**): chave de opencode.ai/auth e o modelo `nemotron-3-ultra-free` já sugerido. Opcional para tudo que usa IA — tradução, corretor, variações das campanhas, assistente do CRM e resumo.
- **IA do resumo separada**: em **Opções → OpenCode Zen (Nemotron)** fica a chave do OpenCode (com **Testar**), o modelo (padrão `nemotron-3-ultra-free`) e **“Usar no Resumo do WhatsApp”**; a mesma escolha aparece na página do Resumo (“Mesma das Opções” / “OpenCode Zen”). Dá para resumir com o Nemotron gratuito e manter outro provedor no resto. A chave é a mesma usada quando o OpenCode é o provedor principal.
- **Resumo transcreve os áudios que faltam** (opção ligada por padrão, na página do Resumo): antes de resumir, os áudios do período sem transcrição — até 1, 3, **5** (padrão), 10 ou 15 min — são transcritos pelo Whisper (chave da **Groq** ou da **OpenAI** em Opções → Variações com IA; o Nemotron não transcreve áudio). A transcrição fica salva e não é refeita; os mais longos continuam em “Ficou de fora”.
- **Apagar resumo**: “Apagar este resumo” e “Apagar todos”, com confirmação. As conversas não são apagadas, e o próximo “desde o último resumo” continua de onde parou.
- Corrigido: salvar as Opções de IA apagava as chaves dos outros provedores; agora cada provedor guarda a sua.
- Atenção: os modelos Nemotron gratuitos são endpoints de teste da NVIDIA, com termos próprios de uso de dados.

## Novidades da 1.19.0

- **Resumo do WhatsApp.** Na **Visão geral** do painel, o cartão **“Resumo do WhatsApp”** tem o botão **Gerar resumo**. A Órbita lê as conversas **e os grupos** com mensagens **desde o último resumo** (ou 24 h, 3 dias, 7 dias) e organiza:
  - **🔴 Precisam da sua resposta** — perguntas e pedidos para você (inclusive quando te marcaram ou responderam a uma mensagem sua em grupo), do mais antigo para o mais novo; o que você já respondeu depois não aparece aqui;
  - **📅 Compromissos e datas** — por dia, com hora; datas como “amanhã às 15h” são calculadas a partir da data da mensagem (quando há dúvida, mostra o trecho original para conferir); **Adicionar ao calendário** baixa um `.ics`;
  - **📢 Avisos e decisões** dos grupos, **🔗 links e documentos**, e um resumo curto **por conversa**.
  - **Cada item mostra a fonte** (conversa, quem, hora e o trecho da mensagem) e **Abrir conversa** leva à mensagem exata, destacada. Itens sem fonte válida são descartados — a IA não consegue inventar de onde tirou algo.
  - **Marcar resolvido**, **Grupos excluídos** (ficam de fora e não vão para a IA) e **resumos anteriores** (os 10 últimos). Só gera quando você clicar.
  - As mensagens do período vão para o provedor de IA das Opções; áudios entram pela transcrição que já existir (os sem transcrição aparecem em “Ficou de fora”).
- **Opções → Variações com IA → “Compatível com OpenAI”** agora mostra o campo da chave (opcional para servidores locais). Serve para provedores como o **OpenCode Zen**: endereço `https://opencode.ai/zen/v1`, a chave de opencode.ai/auth e o modelo (ex.: `nemotron-3-ultra-free`). Vale para tradução, corretor, resumo e variações das campanhas.

## Novidades da 1.18.0

- **Módulo E-mail marketing (Resend)** — desligado por padrão; ligue em **Opções → Módulos**. Desligado, o menu some e nada é enviado; campanhas e descadastros ficam guardados.
  - **Configuração** em Opções → E-mail marketing: chave da API da Resend (Full access; fica fora do backup) com “Testar chave” (mostra os domínios verificados), remetente de um **domínio verificado**, responder-para, e empresa/endereço para o rodapé.
  - **Página E-mail** no painel: campanhas com editor de texto (parágrafos, *negrito*, _itálico_, links e botão) ou HTML próprio, **prévia ao vivo**, **envio de teste**, variáveis `{{primeiro_nome}}` e `{{nome}}` (outras são avisadas antes de enviar).
  - **Público**: todas as listas ou as escolhidas, filtro opcional por etapa do CRM; vai para **todos que têm e-mail** (coluna “email” da lista ou e-mail da ficha do lead), sem repetidos. “Calcular público” mostra quantos recebem, quantos estão sem e-mail e quantos se descadastraram.
  - **Envio pela Resend**: cada campanha vira um segmento na Resend e um broadcast (agora ou **agendado**, com “Cancelar agendamento”). Se algo falhar no meio, **“Continuar envio”** segue de onde parou.
  - **Descadastro** obrigatório e automático: todo e-mail tem o rodapé com “Não quero mais receber”, hospedado pela Resend; os descadastros são sincronizados antes de cada envio e nunca recebem de novo.
  - O envio aparece no histórico do cliente no CRM (“E-mail: assunto”). Aberturas e cliques não são rastreados nesta versão.

## Novidades da 1.17.0

- **Importar contatos de grupos do WhatsApp.** Em **Contatos → Importar contatos → Do WhatsApp**, escolha **Grupos** (ao lado de “Agenda e conversas”): aparecem os seus grupos, com busca e “Marcar todos”. Entram **só os participantes dos grupos marcados**, com as variáveis `{{grupo}}` e `{{admin}}` — em **uma lista para cada grupo** (“Grupo: nome”; reimportar acrescenta só quem entrou) ou **tudo numa lista só**, sem números repetidos. Funciona mesmo com o módulo Conversas desligado.
- **Números ocultos nos grupos.** Quando o WhatsApp mostra um participante sem o número (ID `@lid`), a Órbita consulta o WhatsApp **contato por contato**, como quem clica em cada um, antes de criar a lista (vale também para “Criar lista” no painel do grupo nas Conversas). Quem esconde o número pela privacidade continua de fora, e o total aparece no resultado.

## Novidades da 1.16.0

- **Conversas: responder mensagens (citar), como no WhatsApp.** No menu do balão (setinha), **Responder** abre a faixa “Respondendo a…” acima do campo (Esc ou × cancela). A resposta vai citada no WhatsApp — texto, anexo, figurinha ou áudio. Mensagens que chegam respondendo a outra mostram a citação no balão; clique nela para ir até a mensagem original.
- **Mencionar (@) nos grupos.** Digite `@` e parte do nome para ver os participantes (Tab ou Enter escolhe). A menção vai marcada no WhatsApp (a pessoa é notificada). Nas mensagens, `@5511…` aparece como **@Nome**.

## Novidades da 1.15.0

- **Áudio do cliente em outro idioma, dublado para o português (ElevenLabs).** Com a ElevenLabs como opção principal, os áudios recebidos em inglês (ou outro idioma que não o seu) continuam sendo **transcritos, como sempre**, e ganham um segundo player: **“Em português, dublado com a voz do contato”**. Para a ElevenLabs vai **só o áudio** (convertido em WAV) — a transcrição nunca é enviada.
  - Automático para áudios dos **últimos 2 dias** e até a **duração máxima automática** das preferências (para não gastar créditos com o histórico). Os outros têm o botão **“Ouvir dublado em português”**.
  - Falhas (sem créditos, chave inválida…) aparecem no próprio balão, com “tentar de novo”. Com o Fish Audio como principal, nada é dublado.

## Novidades da 1.14.0

- **Conversas: voz traduzida com a dublagem da ElevenLabs (opcional).** Além do fluxo original (a gravação vira texto, é traduzida e o **Fish Audio** gera a voz), agora dá para **dublar a própria gravação**: a ElevenLabs recebe o áudio e devolve a fala já no idioma do contato, **com a sua voz, entonação e ritmo** — sem transcrição nem geração a partir de texto no meio.
  - **Texto só pelo Fish Audio; a ElevenLabs recebe só o áudio.** Com a **ElevenLabs como principal** (Opções), toda gravação — dentro ou fora do modo áudio — vai direto para a dublagem, sem virar texto. Com o **Fish Audio como principal**, depois de gravar você escolhe na hora: dublar com a ElevenLabs ou transcrever e usar o Fish Audio. Texto digitado no modo áudio sempre vai pelo Fish Audio. Sem a chave da ElevenLabs, nada muda.
  - Você **ouve antes de enviar** (e pode “Dublar de novo”); vai como mensagem de voz gravada, com o selo “Voz gerada por IA” e o aviso opcional ao contato.
  - **Opções → Conversas → Voz traduzida**: chave da ElevenLabs (com “Testar chave”, que mostra o plano e os créditos restantes; fica fora do backup), tirar ruído e música de fundo, e tempo máximo de espera (padrão 180 s).
  - Erros claros para chave inválida, **sem créditos/cota**, dublagem com falha, tempo esgotado, e idioma fora da lista da ElevenLabs (31 idiomas) — conferidos **antes** de enviar o áudio, junto com os limites (1 GB e 2 h 30 min por arquivo; mensagens de voz respeitam a duração máxima das preferências). O projeto é apagado na ElevenLabs depois do download.

## Novidades da 1.13.0

- **Grupos do WhatsApp nas Conversas.** Os grupos aparecem na lista (filtro **Grupos**), com a prévia “Fulano: mensagem”. Na conversa, cada mensagem mostra **quem mandou** (nome colorido e número, como no WhatsApp), e você responde no grupo normalmente.
- **Dados do grupo** no painel lateral: descrição, data de criação e **participantes com nome, número e quem é admin/criador** (busca quando o grupo é grande). Clicar num participante com quem você já conversa abre a conversa dele.
- **Lista de contatos a partir de grupo.** “Criar lista” gera uma lista separada (“Grupo: nome”, origem **Grupo do WhatsApp** em Contatos) com as variáveis `{{grupo}}` e `{{admin}}`. Depois, “Atualizar lista” acrescenta quem entrou. Para vários grupos de uma vez: filtro **Grupos → Criar listas dos grupos**, marque os grupos e pronto (uma lista por grupo, sem duplicar). O seu número e os números ocultos pelo WhatsApp (IDs `@lid` sem número) ficam de fora, e o painel avisa quantos.
- **Conversas: emojis e figurinhas.** Botão **😊** ao lado do campo de mensagem abre um painel como o do WhatsApp:
  - **Emojis**: busca em português (“coração”, “polegar”, “foguete”; acentos opcionais, Enter insere o primeiro), categorias com rolagem e destaque da atual, **recentes**, **tom de pele** e prévia do nome. O painel fica aberto enquanto você escolhe e o cursor volta ao campo. Só aparecem emojis que o seu computador sabe desenhar, e as **bandeiras** funcionam também no Windows.
  - **Digite `:` e parte do nome** (ex.: `:foguet`) para sugestões na hora: Tab ou Enter escolhe, setas navegam, Esc fecha.
  - **Figurinhas**: as que chegam nas conversas entram sozinhas na sua coleção; **favoritas** (estrela), **criar figurinha** a partir de qualquer imagem (vira 512×512 com fundo transparente) e remover. Um clique envia como figurinha, e ela aparece na conversa na hora.
  - Mensagens só com 1 a 3 emojis aparecem **grandes**, como no WhatsApp.
  - Créditos: nomes dos emojis do [emojibase](https://emojibase.dev) (MIT); bandeiras da fonte “Twemoji Country Flags” (arte do Twemoji, CC-BY 4.0 — `fonts/LICENSE-TwemojiCountryFlags.md`).

## Novidades da 1.12.0

- **Conversas: figurinhas como no WhatsApp.** Aparecem inteiras (animadas, quando forem), sem balão em volta e com o horário num selo sobre a imagem. São baixadas sozinhas ao abrir a conversa e guardadas no computador.
- **Corrigido: “Operação desconhecida” (apagar mensagem, enviar anexo…)** depois de uma atualização. O atualizador troca os arquivos, mas o Chrome podia continuar rodando a parte de segundo plano da versão antiga. Agora a Órbita confere isso ao iniciar e se recarrega sozinha, reabrindo as telas que estavam abertas; e, se as Conversas encontrarem a versão antiga, mostram o aviso **Recarregue a Órbita** com um botão.
- **Conversas: corretor.** O botão com o **A e o ✓**, ao lado do campo de mensagem, **corrige o texto na hora** (ortografia, acentos, pontuação e gramática), sem enviar; **Ctrl+Z** desfaz. A IA muda o mínimo: não reescreve nem muda o tom, e se mexer em links, números, preços ou {{variáveis}} a correção é descartada. Funciona também com a tradução ligada (corrige o seu português). Opcional em **Opções → Conversas → Corretor**: **corrigir automaticamente ao enviar** (desligado por padrão), com prévia das palavras alteradas (Enter envia o corrigido, ou Enviar original / Editar) ou envio direto.

## Novidades da 1.11.0

- **Conversas: anexar como no WhatsApp.** Cole um print com **Ctrl+V**, **arraste** fotos, vídeos, áudios ou documentos para a conversa, ou use o **clipe**. Abre uma prévia com miniaturas (dá para adicionar mais, remover e trocar a visualização) e uma legenda; **Enter** envia e **Esc** cancela. Prints colados ganham nome com data e hora. Arquivos de até 100 MB (vão em pedaços para a aba do WhatsApp). Com a tradução ligada, a legenda passa pela prévia e sai traduzida.

## Novidades da 1.10.0

- **CRM: ficha do lead** no card do cliente (painel → CRM) e no painel lateral das Conversas, em quatro seções recolhíveis. Grava sozinho ao sair de cada campo:
  - **Lead**: nome, WhatsApp, e-mail, empresa, origem, responsável, status (Novo, Em contato, Qualificado, Ganho, Perdido, Desqualificado), temperatura (Frio / Morno / Quente), produto/serviço de interesse, valor potencial e observações.
  - **Oportunidade**: etapa (a do funil), valor, previsão de fechamento, probabilidade e valor ponderado; o **motivo de perda** aparece quando o status é “Perdido”.
  - **Atividades**: tipo (Ligação, WhatsApp, E-mail, Reunião, Visita, Tarefa), data/hora, responsável, descrição, resultado e próxima ação (com data). Entram também no histórico do cliente, e a próxima ação mais recente fica em destaque.
  - **Marketing**: UTM Source, UTM Medium, UTM Campaign e landing page.
  - Origem, responsável, produto, resultado e UTMs sugerem os valores já usados. Os cards do Kanban mostram a temperatura e o valor. Os dados entram no backup.

## Novidades da 1.9.1

- **Conversas: apagar mensagem.** Passe o mouse no balão e abra o menu: **Apagar para mim** (some das Conversas e do seu WhatsApp; o contato continua vendo) ou **Apagar para todos** (só nas suas mensagens e dentro do prazo do WhatsApp, cerca de 2 dias e meio). As duas pedem confirmação.

## Novidades da 1.9.0

- **Conversas: resumo do CRM editável** no painel lateral: nome, etapa do funil, tags, notas (incluir/excluir), “IA responde este cliente”, alerta de atenção e “Adicionar ao CRM”. Grava no mesmo formato do CRM do painel, que se atualiza na hora. (Corrigido: as notas do CRM não apareciam no painel.)
- **Foto de perfil** do WhatsApp na lista, no cabeçalho e no painel (links expirados são renovados sozinhos).
- **Mídias**: miniaturas de fotos e vídeos no balão; clique abre o visualizador (foto, vídeo e PDF, com setas entre as mídias, baixar e Esc). Documentos com tipo, páginas e tamanho, para abrir ou baixar. Arquivos de até 100 MB (transferidos em pedaços).
- **Respostas rápidas dentro das Conversas**: barra sob o campo, “/atalho” e botão ⚡. Com a tradução ligada, os textos são traduzidos e mostrados numa prévia antes de enviar.
- **Tela cheia na página**: o botão agora faz o chat ocupar toda a aba do painel (não o monitor); Esc volta.
- **Liga/desliga** das Conversas em Opções → Módulos.
- Corrigido: **“Áudio não enviado: invalid_data_url”** ao enviar voz (Conversas e respostas rápidas) — a voz agora vai como arquivo.

## Novidades da 1.8.2

- **Fish Audio: “créditos acabados” em contas sem plano pago da API.** O modelo padrão agora é o `s2.1-pro-free` (os modelos `s2.1-pro`, `s2-pro` e `s1` exigem créditos pagos e respondiam 402). Se o modelo escolhido responder 402, a voz é gerada com o gratuito, que passa a ser o padrão, e um aviso explica a troca. As Opções indicam qual modelo exige créditos.

## Novidades da 1.8.1

- **Conversas em tela cheia**: botão no topo da lista de conversas (ou Esc para sair) — só o chat ocupa o monitor, sem o menu e o cabeçalho do painel. Se o navegador não permitir, o chat abre numa janela só dele.
- Correções visuais: cabeçalho da lista de conversas não invade mais a conversa; avisos de tradução/transcrição longos quebram a linha dentro do balão.

## Novidades da 1.8.0

### Conversas: chat com tradução bilateral (texto e áudio)

Nova página **Conversas** no painel: converse com seus contatos do WhatsApp pelo painel da Órbita, lendo e escrevendo em português, com tradução automática para o idioma do contato.

- **Chat próprio**: lista de conversas (busca, não lidas, clientes do CRM), mensagens em tempo real, confirmações de leitura, mensagens apagadas/editadas, histórico ao rolar e painel do cliente (etapa, tags, notas, compromissos). Funciona enquanto o WhatsApp Web estiver aberto numa aba.
- **Tradução por conversa** (botão *Traduzir*): as recebidas aparecem em português (com “mostrar original”); você escreve em português e vê uma **prévia** com o texto que será enviado e a tradução de volta antes de clicar em Enviar. Idioma do contato automático (detectado) ou fixo, tom formal/informal, glossário.
- **Falha segura**: com a tradução ligada, a extensão só envia um texto idêntico a uma tradução que ela gerou e você aprovou. Se a IA falhar, demorar ou alterar links/números/variáveis, **nada é enviado**.
- **Áudio recebido**: player no balão, transcrição (Whisper via Groq ou OpenAI) e tradução da transcrição. Só processa com a conversa aberta; áudios longos (padrão > 3 min) só com clique.
- **Áudio enviado com voz gerada** (Fish Audio): grave em português (vira texto para revisar) ou digite, confira a tradução, gere a voz, **ouça** e envie como mensagem de voz gravada. Selo “Voz gerada por IA” e aviso opcional ao contato.
- **Menu lateral recolhível** (botão ou Ctrl+B).
- O backup passa a incluir conversas e mensagens (sem os caches de mídia/tradução e sem chaves de API).

#### Como configurar

1. **Opções da extensão → Variações com IA**: escolha o provedor e informe a chave (é o mesmo provedor usado na tradução). Para transcrever áudios, é preciso uma chave da **Groq** ou da **OpenAI**.
2. **Opções → Conversas: tradução e voz**: seu idioma, idioma padrão do contato, tom, glossário e, para voz, a chave do **Fish Audio** e a voz (crie a sua em “Criar a minha voz”: grave 10–30 s, sem ruído).
3. No painel, abra **Conversas** com o WhatsApp Web aberto numa aba, escolha a conversa e clique em **Traduzir**.

#### Privacidade e riscos

- Com a tradução ligada, o texto das mensagens (e algumas anteriores, como contexto; configurável, 0 desliga) é enviado ao provedor de IA configurado. Áudios abertos vão ao Whisper (Groq/OpenAI); textos para voz, ao Fish Audio. Um aviso aparece na primeira ativação.
- Conversas, traduções e áudios ficam só neste navegador (IndexedDB `orbita-chat`). O conteúdo das mensagens não é registrado em logs. As chaves ficam em `chrome.storage.local` e **não entram no backup**.
- **Voz clonada**: use apenas a sua voz ou uma com autorização expressa. Recomendamos ligar o aviso “(áudio com voz gerada por IA)”.
- Automatizar o WhatsApp Web pode violar os Termos do WhatsApp e gerar risco para o número. As Conversas são 1:1 e conduzidas por você, mas o risco existe.

#### Limitações conhecidas

- Só conversas 1:1 (grupos ficam de fora), texto e áudio. Figurinhas, fotos, vídeos, enquetes etc. aparecem como “📎 Mídia” com a legenda.
- A aba do WhatsApp Web precisa estar aberta para receber e enviar (com ela fechada, o painel mostra o que já estava salvo).
- Contatos cujo número o WhatsApp esconde (IDs `@lid`) aparecem, mas não são ligados ao CRM.
- Ler uma conversa no painel não marca como lida no celular.
- Um mesmo contato que fale com duas contas suas aparece na conta usada por último.

#### Como funciona (para quem vai mexer no código)

```
aba do WhatsApp (js/chat-page.js, WA-JS) ⇄ js/chat-content.js ⇄ porta "orbita-chat"
      ⇄ service worker: js/chat-sync.js (+ chat-translate.js, chat-transcribe.js, chat-voice.js)
      ⇄ banco orbita-chat (js/chat-common.js)
      ⇄ painel: conversas.html / js/conversas.js (canal "orbita:chat" + porta "orbita-chat-ui")
```

- O painel nunca fala direto com a aba do WhatsApp; tudo passa pelo service worker (`js/background.js` carrega o bundle original e os módulos novos).
- Banco próprio `orbita-chat` em vez de subir o `orbita` para v4: a migração do `orbita` está duplicada em dois bundles minificados, e mudar só um quebraria o outro.
- Motor de tradução separado da interface (`js/chat-translate.js`), reutilizável numa futura sobreposição no WhatsApp Web.
- Menu e rota no painel: `patches/7-conversas.json`.

#### Testes

```sh
node --test tests/*.test.mjs            # unitários (motor de tradução, transcrição, voz, utilidades)
npm i -D playwright && npx playwright install chromium
node tests/e2e/chat-sync.e2e.mjs        # e também: conversas-ui, translation, audio, voice, options, fullscreen, crm-panel, avatar, media, chat-quick-replies, module-toggle, delete, lead-form, attach, autocorrect, stale-worker, sticker, emoji-sticker, groups, dub, dub-incoming, reply-mention, group-import, email, summary, ai-providers, cloud
```

Os testes de ponta a ponta carregam a extensão num Chromium com um WhatsApp Web simulado (`tests/e2e/fake-whatsapp.html`) e provedores de IA/voz simulados — nenhuma chave real é usada.

**Roteiro de teste manual (com WhatsApp e chaves reais)** — ainda precisa ser executado:

- [ ] Instalação existente atualizada para 1.8.0: campanhas, CRM, agenda e respostas rápidas continuam normais.
- [ ] Abrir conversa de um contato do CRM; receber texto em inglês; ver em português; alternar o original.
- [ ] Enviar em português; conferir prévia, retro-tradução e o que chegou no celular.
- [ ] Desligar a tradução numa conversa em português e confirmar que nada é traduzido.
- [ ] Derrubar a internet no meio do envio: nada é enviado e o erro é claro.
- [ ] Receber áudio: transcrição, tradução e player.
- [ ] Enviar áudio gerado: chega como mensagem de voz, toca no celular, dura o esperado.
- [ ] Fechar e reabrir a aba do WhatsApp com o painel aberto: aviso e retomada sem duplicatas.
- [ ] Backup e restauração: mensagens voltam; chaves de API não são exportadas.

## Novidades da 1.7.1

- Respostas rápidas: a barra agora se adapta ao layout do WhatsApp Web (rodapé em fluxo, absoluto ou em grid) e fica sempre logo abaixo do campo de mensagem — antes podia aparecer embaixo do cabeçalho da conversa.

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
| `10-ficha-lead.json` | `js/dashboard.js` | CRM só com etapa, tags e notas | Ficha do lead (`js/lead-form.js`) no card do cliente; clientes do Kanban trazem `lead`/`deal` e o card mostra temperatura e valor |
| `15-opencode.json` | `js/service_worker.js` | Sem OpenCode Zen nas variações/assistente | Provedor `opencode` (https://opencode.ai/zen/v1) e preferência pelo `nemotron-3-ultra-free` |
| `14-resumo.json` | `js/dashboard.js` | Sem resumo das conversas | Cartão “Resumo do WhatsApp” na Visão geral (`js/summary-card.js`) e rota `#/resumo` (`resumo.html` em iframe) |
| `13-modulo-email.json` | `js/dashboard.js` | Sem e-mail marketing | Módulo `email` (padrão desligado), item “E-mail” no menu e rota `#/email` (`email.html` em iframe) |
| `12-importar-grupos.json` | `js/dashboard.js` | Importar do WhatsApp só lia agenda e conversas | Escolha “Agenda e conversas” / “Grupos” no topo da aba “Do WhatsApp” (`js/group-import.js`) |
| `11-listas-de-grupo.json` | `js/dashboard.js` | Listas com origem desconhecida quebravam a página Contatos | Origem “Grupo do WhatsApp” (`whatsapp-group`, ícone de pessoas) e fallback para outras origens |
| `9-modulo-conversas.json` | `js/dashboard.js` | Conversas sem liga/desliga | Módulo `conversas` (padrão ligado) e item do menu ligado a ele |
| `8-conversas-tela-cheia.json` | `js/dashboard.js` | iframe das Conversas sem permissão de tela cheia | `allow="microphone; fullscreen"` e `allowFullScreen` |
| `7-conversas.json` | `js/dashboard.js` | Sem chat no painel | Item “Conversas” no menu e rota `#/conversas` (página `conversas.html` em iframe) |
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
node patches/patch.mjs js/dashboard.js patches/7-conversas.json
node patches/patch.mjs js/dashboard.js patches/8-conversas-tela-cheia.json
node patches/patch.mjs js/dashboard.js patches/9-modulo-conversas.json
node patches/patch.mjs js/dashboard.js patches/10-ficha-lead.json
node patches/patch.mjs js/dashboard.js patches/11-listas-de-grupo.json
node patches/patch.mjs js/dashboard.js patches/12-importar-grupos.json
node patches/patch.mjs js/dashboard.js patches/13-modulo-email.json
node patches/patch.mjs js/dashboard.js patches/14-resumo.json
node patches/patch.mjs js/service_worker.js patches/15-opencode.json
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
