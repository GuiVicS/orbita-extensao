# Orbita Updater

App (Windows) que instala e mantém a extensão **Orbita** sempre
atualizada, baixando automaticamente a última versão publicada no repositório
[GuiVicS/orbita-extensao](https://github.com/GuiVicS/orbita-extensao).

## Como funciona

1. **Primeira execução**: o `.exe` se copia para `%LOCALAPPDATA%\OrbitaUpdater`,
   passa a iniciar junto com o Windows (sem precisar de admin), pede pra
   escolher a pasta da extensão, baixa a versão mais recente e abre o
   `chrome://extensions` e a pasta, prontos para o passo manual abaixo.
   O arquivo baixado pode ser apagado depois.
2. **Execuções seguintes**: fica rodando na bandeja do sistema (ícone perto
   do relógio do Windows), verificando a cada 15 minutos se saiu uma versão
   nova no GitHub.
3. **Ao achar atualização**: fecha o Chrome sozinho, substitui os arquivos
   pela versão nova, e reabre o Chrome — tudo automático.

Na primeiríssima vez, ainda é preciso carregar a extensão manualmente no
Chrome (isso o Chrome não permite automatizar):

1. Abra `chrome://extensions`
2. Ative "Modo do desenvolvedor"
3. Clique em "Carregar sem compactação" e selecione a pasta que o app criou

Da próxima vez que tiver atualização, os arquivos são substituídos e o
Chrome reaberto sozinho — não precisa recarregar manualmente de novo.

## Rodando localmente (modo desenvolvimento/teste)

```bash
pip install -r requirements.txt
python main.py
```

## Gerando o executável (.exe)

Precisa ser feito numa máquina **Windows** com Python instalado
(`winget install -e --id Python.Python.3.12`). É só rodar o `build.bat`.

O executável final fica em `dist\OrbitaUpdater.exe` — é esse arquivo único
que você distribui pro time (link compartilhado, pen drive, etc.). Quem
recebe não precisa instalar nada além dele.

Como o `.exe` não é assinado digitalmente, o Windows pode mostrar
"O Windows protegeu o computador" na primeira vez: clique em
**Mais informações → Executar assim mesmo**.

## Menu da bandeja

- **Verificar atualização agora**
- **Abrir pasta da extensão**
- **Sair** — fecha até o próximo login no Windows
- **Desinstalar atualizador** — tira da inicialização e apaga o `.exe`
  instalado (a pasta da extensão é mantida)

## Publicando uma atualização (lado do repositório da extensão)

Este app sempre busca a **última Release** do GitHub (o repositório precisa
ser público), com um `.zip` anexado contendo a extensão.

Copie o arquivo `github-actions-release.yml` incluído aqui para
`.github/workflows/release.yml` no repositório `orbita-extensao`. A partir
daí, todo push na branch `main`:

1. Zipa os arquivos da extensão (o repositório já é a extensão pronta)
2. Cria uma Release no GitHub com esse zip anexado (nome baseado na versão
   do `manifest.json`)

**Importante:** pra sair uma release nova, é preciso subir a versão no
`manifest.json` (ex: `1.0.0` → `1.0.1`) antes do push — se a versão não
mudou, o workflow não publica nada (proteção contra publicar a mesma
versão duas vezes sem querer).

## Estrutura dos arquivos

| Arquivo | Responsabilidade |
|---|---|
| `main.py` | Orquestra tudo: setup inicial, checagem, loop em background |
| `installer.py` | Auto-instalação, início com o Windows, instância única, desinstalar |
| `config.py` | Lê/grava config em `%APPDATA%\OrbitaUpdater\config.json` |
| `github_api.py` | Consulta a API do GitHub (última release + asset .zip) |
| `updater.py` | Baixa e extrai o zip na pasta de instalação (com backup) |
| `chrome_control.py` | Fecha e reabre o Chrome |
| `notifier.py` | Notificação nativa do Windows (toast) |
| `gui.py` | Formulário de primeira execução (escolher pasta) |
| `tray.py` | Ícone e menu na bandeja do sistema |
