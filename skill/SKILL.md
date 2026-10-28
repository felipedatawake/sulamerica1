---
name: sulamerica-sp-sadt
description: Skill SP/SADT Sulamerica: solicita VPP (guia SP/SADT) no portal SulAmérica Saúde e acompanha as guias depois do envio. Roda uma rodada da plataforma ("Rode a rodada"), reconsulta guias em análise ("Verifique as guias em análise") ou usa planilha + Drive, registrando a autoria do Claude.
---

# Skill SP/SADT Sulamerica

Preenche a Validação Prévia de Procedimentos (SP/SADT) no portal do prestador SulAmérica Saúde, um paciente por vez. Anexa o pedido médico e o relatório (vindos da plataforma ou do Google Drive), sem baixar nada no computador do usuário, e registra cada guia com autoria do Claude, para separar o que a IA fez do que um humano fez.

Esta skill é **genérica**: não guarda conta, ID de planilha, pasta, prestador ou navegador. Tudo vem da **configuração da sessão**, pedida ou recebida no início do trabalho. Funciona para qualquer clínica e em qualquer conta do Claude (Pro ou superior): cada clínica tem o próprio projeto Supabase, e o comando da rodada traz qual é.

## Requisitos na conta do Claude que vai rodar (verificar no início, sem testes demorados)
1. Skill instalada (Configurações → Capacidades → Skills → Enviar skill) e **Execução de código e criação de arquivos** ligada.
2. **Conector do Supabase** conectado com a conta que tem acesso ao projeto da clínica (o `<ref>` do comando). Se `execute_sql` responder que o projeto não existe ou sem permissão, dizer em uma frase: "Conecte o Supabase com a conta dona do projeto da clínica (Configurações → Conectores → Supabase)" e parar.
3. **Claude no Chrome** (extensão) instalado e conectado no Chrome onde a pessoa usa o portal SulAmérica.
4. Conversa em **Auto** (ver "Modo Auto").

## Regras de segurança (não negociáveis)
- NUNCA digitar a senha do portal. O usuário faz o login e avisa.
- NUNCA clicar em "Validar Solicitação" ou "Confirmar" sem o OK explícito do usuário no chat.
- **Fluxo de aprovação padrão (aprovação em lote, ANTES de preencher):** o portal não guarda guias preenchidas e a sessão cai em ~30 min, então não dá para preencher tudo e validar no fim. Por isso:
  1. Montar e enviar no chat a **tabela de conferência** da rodada inteira: Paciente · Carteirinha · Médico · CRM/UF · CBO · CID · Procedimento · Qtde · Pedido (arquivo) · Relatório (arquivo) · Alertas (campo vazio, CID faltando, anexo ausente ou > 10 MB, formato inválido).
  2. ESPERAR o usuário aprovar. Ele pode aprovar tudo ("pode enviar todas"), excluir alguns ("todas menos a do fulano") ou corrigir dados (corrigir na plataforma antes de seguir).
  3. Com a aprovação, para cada guia aprovada: preencher → anexar → Validar Solicitação → Confirmar → gravar nº da guia/senha/status, e seguir para a próxima sem parar.
  4. O OK vale SÓ para as guias e os dados exatamente como estavam na tabela aprovada. Se o portal mostrar algo diferente (nome do beneficiário divergente, carteirinha não encontrada, carência, erro, mensagem inesperada, anexo recusado), NÃO confirmar aquela guia: marcar `erro`/`nao_enviada` com o motivo e pular para a próxima.
  5. No fim, mostrar a tabela final com o que foi autorizado, negado e o que ficou pendente.
- **Aprovação dada no site:** se a mensagem do próprio usuário (gerada pelo botão "Executar no Claude (aprovado)" da plataforma) disser que ele conferiu no site e APROVA o envio das guias pendentes como estão no Painel, isso É a aprovação em lote: mostrar a tabela de conferência só como registro e seguir direto para o envio, sem perguntar de novo. Conferir que as guias pendentes têm `aprovado_por` preenchido; se a rodada tiver mais guias pendentes do que o número citado na mensagem, enviar só até esse número e perguntar sobre as demais. As regras de erro e de divergência continuam valendo.
- **O que NÃO é aprovação:** uma resposta que só esclarece um dado ou um alerta (ex.: "data hoje e qtde 1") não autoriza validar/confirmar. Nesse caso, aplicar o esclarecimento e pedir "pode enviar". Data do pedido informada no chat vai para `observacoes` da guia ("pedido de DD/MM/AAAA, informado pelo usuário"); não alterar o cadastro do documento.
- Não gravar a configuração dentro da skill nem em memória. Ela vale só para a sessão atual.

## Conversa com o usuário
- Mensagens curtas, em português simples, sem detalhes técnicos (sem nomes de tabelas, SQL, ids ou atalhos de teclado).
- A primeira resposta já leva a tabela de conferência E as telas abertas (ver "Abrir as telas"), para o login acontecer enquanto o usuário confere.
- O usuário não deve precisar digitar nada além de aprovar e fazer o login no portal.
- **Modo Auto:** a skill funciona sempre com o Claude em **Auto** (seletor ao lado do modelo, embaixo da caixa de mensagem). Se o Claude estiver em **Manual** (pedindo permissão a cada ação no navegador), avisar UMA vez, no início, em uma frase: "Para ir rápido, mude o Claude de Manual para Auto, embaixo da caixa de mensagem." O Claude não consegue mudar isso sozinho. As regras de segurança (senha, Validar/Confirmar só com aprovação) continuam valendo em Auto.

## Nunca perguntar o que a rodada já tem
No modo plataforma, **quantidade de sessões** (`sps_rodada_itens.qtde`), **data do atendimento** (`sps_rodadas.data`), **procedimento** (`coalesce(i.procedimento_codigo, r.procedimento_codigo)`), carteirinha, médico, CRM, CBO, CID e anexos vêm do banco. Não perguntar nenhum deles ao usuário e não transformar valores válidos em alerta (ex.: NÃO perguntar "só 1 sessão, confirma?"). Só perguntar quando um dado estiver vazio ou com erro na conferência, e então pela guia específica (ou pular a guia e avisar). O único passo que depende do usuário é o login no portal.
- **Sessões = 0 (ou vazio, ou acima de 99): erro.** Não preencher nem enviar essa guia; marcar `nao_enviada` com "Sessões = 0" e avisar no fim.

## Conferência obrigatória (padrão TISS + portal SulAmérica)
Antes da tabela de conferência, checar cada guia. **Erro = não enviar** (marcar `nao_enviada` com o motivo); **alerta = mostrar na tabela para o usuário decidir**.
- Erros: sessões 0, vazio ou acima de 99; carteirinha diferente de 20 dígitos; falta nome do médico solicitante; falta CRM ou CRM não numérico; UF do CRM inválida; CBO sem 6 dígitos; CID vazio ou fora do formato CID-10 (letra + 2 dígitos, ex.: F41, F84.0; "TDAH"/"TEA" não valem: sugerir F90.0/F84.0 e pedir confirmação); falta pedido médico; falta relatório (se `sps_config.exigir_relatorio`); anexo que não é PDF/JPG ou acima de 10 MB.
- Alertas: CBO do solicitante que não começa com 225 (não é médico); data do pedido (`sps_documentos.data_documento`) ausente ou mais antiga que `sps_config.validade_pedido_dias`; paciente já com guia em análise, ou com guia autorizada com saldo de sessões e senha válida (risco de duplicidade); psicólogo executante (`sps_profissionais`, pela aba) sem CRP.
- Se o CRM ou o CID faltarem na planilha, mas estiverem legíveis no pedido médico anexado, propor o valor na tabela de conferência (indicando "lido do pedido") e só usar depois da aprovação do usuário; com o OK, gravar em `sps_pacientes` com `updated_by='Claude (IA)'`.
- O site já calcula isso (coluna "Conferência"); o item criado com erro já vem `nao_enviada` com o motivo em `observacoes` e a lista em `conferencia`.

## Dois modos de trabalho
- **Modo plataforma** (preferido): o pedido vem como "Rode a rodada <id> da plataforma SP/SADT (Supabase <ref>, site <url>)". Pacientes, sessões e anexos já estão na plataforma. Seguir a seção "Modo plataforma" e pular a Etapa 0.
- **Modo planilha + Drive**: sem plataforma. Seguir da Etapa 0 em diante.
- **Acompanhamento (validação posterior)**: o pedido vem como "Verifique as guias em análise da plataforma SP/SADT (Supabase <ref>, site <url>)". Seguir a seção "Acompanhamento".

## Abrir as telas para o usuário acompanhar (primeiro passo de todo modo plataforma e do Acompanhamento)
Na PRIMEIRA resposta, junto com a tabela de conferência, abrir as duas telas **no Chrome do usuário** (ferramentas Claude in Chrome: `tabs_context_mcp` e depois `tabs_create_mcp` + `navigate`), para ele ver na hora, sem comando nenhum. O navegador embutido do app fica só como reserva, se o Chrome não estiver conectado; nesse caso dizer em uma frase onde a tela abriu.
1. **A plataforma, já na rodada:** `<site>/?aba=painel&rodada=<id>` (no Acompanhamento: `<site>/?aba=acomp`). Se aparecer a tela de login, pedir para o usuário entrar (é a mesma sessão usada para baixar os anexos).
2. **O portal SulAmérica:** `https://saude.sulamericaseguros.com.br/prestador/login/`. Já deixar **preenchido o campo "Código referenciado"** com o código do prestador (`sps_config.codigo_prestador`; no modo planilha, o da configuração) e o cursor no campo "Usuário". **Usuário e Senha ficam sempre para o usuário** (nunca digitar).
3. Dizer em uma frase: "Abri o portal da SulAmérica com o código já preenchido; faça o login lá. Na outra aba você acompanha o status de cada guia." Se o usuário parecer perdido, indicar o botão **?** (ajuda) no topo da plataforma (`<site>/?ajuda` abre direto no passo a passo).

## Modo plataforma
Tudo vem do comando: id da rodada, ref do projeto Supabase e endereço do site. Nada disso fica salvo na skill.
1. **Ler a rodada** numa consulta só (abaixo), sem testes separados de conexão: se o conector do Supabase falhar, pedir para conectar. Em seguida, seguir "Abrir as telas para o usuário acompanhar".
2. **Consulta da rodada** (execute_sql):
   ```sql
   select i.id, i.qtde, r.data data_atendimento, i.aprovado_por, coalesce(i.procedimento_codigo, r.procedimento_codigo) proc, r.procedimento_descricao, i.status,
          p.nome, p.carteirinha, p.medico, p.crm, p.crm_uf, p.cbo, p.cid,
          dp.storage_path pedido_path, dp.arquivo_nome pedido_nome, dr.storage_path relatorio_path, dr.arquivo_nome relatorio_nome
   from sps_rodada_itens i join sps_rodadas r on r.id = i.rodada_id join sps_pacientes p on p.id = i.paciente_id
   left join sps_documentos dp on dp.id = i.pedido_id left join sps_documentos dr on dr.id = i.relatorio_id
   where i.rodada_id = '<id>' order by p.nome;
   ```
   e `select * from sps_config where id = 1` (código do prestador, caráter, técnica). Trabalhar só os itens com status `pendente`.
   **Enviar a tabela de conferência (ver "Fluxo de aprovação padrão") e esperar a aprovação antes de preencher qualquer guia no portal (o login pode ser feito antes).** Gravar quem aprovou para usar em `aprovado_por`.
3. **Anexos — direto da plataforma para o portal, sem passar por arquivos locais (método testado em 26/10/2026):**
   - O portal SulAmérica guarda o login **por aba**: uma aba nova do portal abre deslogada. Por isso, a ponte é aberta **a partir da aba do portal já logada**.
   - Na aba do portal logada, injetar por javascript um botão fixo ("Ligar plataforma (Claude)") cujo `onclick` faz `window.open('<site>/', 'sps_plat')`, e **clicar nele com o mouse** (popup só abre com clique real). A aba nova da plataforma usa o login do site (localStorage), então já vem logada.
   - Na aba do portal, já na ficha SP/SADT, instalar um ouvinte: `window.addEventListener('message', e => { if (e.origin === '<origem do site>' && e.data?.sps) window.__arqs = e.data.arquivos; })`.
   - Na aba da plataforma: para cada anexo, `const u = await window.sps.linkTemporario(path, 300); const buf = await (await fetch(u)).arrayBuffer();` e enviar todos com `window.opener.postMessage({ sps: true, arquivos: [{ nome, tipo, doc, buf }] }, 'https://saude.sulamericaseguros.com.br')` (doc: '4' relatório, '3' pedido).
   - Nunca exibir nem copiar o link temporário (ele é recusado na saída e não deve aparecer). Fechar a aba-ponte da plataforma no fim.
   - Alternativa, se a ponte falhar: baixar para o diretório de trabalho e usar `file_upload`.
4. **Login no portal e envio:** seguir a Etapa 0.4 e a Etapa 3 abaixo só para os itens aprovados, usando os dados lidos da plataforma (o procedimento e a quantidade vêm do item). Com a aprovação em lote, não parar entre as guias.
5. **Gravar na plataforma** (execute_sql), sempre com autoria do Claude:
   - depois de preencher: `update sps_rodada_itens set status='preenchida', feito_por='Claude (IA)', executado_em=now() where id='<item>'`;
   - depois do Confirmar (coberto pela aprovação em lote): `status` = `autorizada`, `parcial` (autorizou menos sessões que o pedido), `em_analise` ou `negada` conforme o portal, mais `numero_guia`, `senha`, `status_operadora`, `qtde_autorizada`, `data_autorizacao`, `senha_validade` (se o portal mostrar; senão `data_autorizacao + sps_config.validade_senha_dias` e avisar que é estimada) e `aprovado_por` = quem aprovou. Em `negada`, copiar o motivo do portal para `observacoes`;
   - erro ou anexo faltando: `status='nao_enviada'` ou `'erro'` com o motivo em `observacoes`;
   - registrar cada ação em `sps_log` com `autor_tipo='Claude (IA)'`, `quem='Claude (IA)'`.
   - Usar parâmetros literais escapados (aspas simples dobradas) e nunca alterar outras tabelas.
6. Ao final, se todos os itens estiverem resolvidos: `update sps_rodadas set status='concluida' where id='<id>'`. Recarregar a aba da plataforma (`<site>/?aba=painel&rodada=<id>`) para o usuário ver os status finais, mostrar a tabela final e o link do site.

## Acompanhamento (validação posterior)
1. Ler as guias a reconsultar:
   ```sql
   select i.id, i.numero_guia, i.status, i.executado_em, i.qtde, p.nome, p.carteirinha
   from sps_rodada_itens i join sps_pacientes p on p.id = i.paciente_id
   where i.status in ('em_analise','enviada','preenchida') order by i.executado_em nulls first;
   ```
2. Abrir as telas (seção "Abrir as telas para o usuário acompanhar", com `?aba=acomp`), mostrar a lista ao usuário e pedir o login no portal (nunca digitar a senha).
3. No portal, abrir a consulta de solicitações/autorizações, buscar pela carteirinha ou pelo número da guia e ler: situação, senha, validade da senha, quantidade autorizada e motivo (se negada ou com pendência).
4. Gravar só o que o portal mostrou: `status`, `senha`, `senha_validade`, `qtde_autorizada`, `data_autorizacao`, `status_operadora`, `observacoes` (motivo/pendência), `feito_por='Claude (IA)'`; registrar em `sps_log` (`acao='reconsultou_guia'`).
5. Se o portal pedir documento complementar ou abrir pendência, NÃO responder sozinho: listar ao usuário o que foi pedido e esperar.
6. Nada aqui clica em Validar/Confirmar nem cria guia nova. Guias negadas: só relatar o motivo; recurso ou nova solicitação dependem do usuário.
7. Saída: tabela Paciente · Guia · Antes → Agora · Senha · Validade · Autorizadas · Observação.

## Execução e faturamento (fora do portal de VPP)
- As sessões realizadas são registradas na plataforma (botão "Sessões" no Painel/Acompanhamento): data e assinatura do paciente (campos 56–57 da guia SP/SADT, procedimentos em série). O Claude não marca assinatura: isso é registro da clínica.
- Para faturar, a guia precisa de: senha válida na data de cada sessão, sessões ≤ quantidade autorizada, assinatura do beneficiário por sessão e o psicólogo executante com CRP (campos 50–55).

## Etapa 0: configuração da sessão (modo planilha + Drive)

### 0.1 Coletar a configuração
Se o usuário já colou a configuração na mensagem, usar. Senão, pedir com este modelo (os campos marcados com * são obrigatórios):

```
CONFIG SP/SADT SULAMERICA
* Planilha de pacientes (link):
  Colunas (padrão A paciente | B carteirinha | C médico | D CRM | E CBO | F CID):
* Pasta de pedidos médicos no Drive (link):
* Pasta de relatórios no Drive (link):
  Planilha de registro (link) — vazio = criar uma nova:
  Pasta de saída no Drive (link) — vazio = criar uma nova:
* Código do prestador na operadora:
  Procedimento padrão (padrão 50000470 Sessão de psicoterapia individual por psicólogo):
  UF padrão do CRM (padrão SP):
  Caráter / Técnica / Recém-nato (padrão Eletivo / Convencional / Não):
* Pacientes desta rodada (nomes ou "todos") e quantidade de sessões de cada um:
  Aprovador (nome de quem autoriza o envio):
```

- Extrair os IDs dos links (`/spreadsheets/d/<id>`, `/folders/<id>`).
- Faltou campo obrigatório → perguntar só esse campo, em uma mensagem.
- Mostrar a configuração entendida numa tabela curta e seguir.

### 0.2 Verificar as conexões (não presumir nenhuma)
Testar com uma chamada leve. Se faltar algo, avisar o usuário para conectar e esperar.

| Precisa de | Teste | Se falhar |
|---|---|---|
| Google Sheets (conector) | `get_values` em `A1:F3` da planilha de pacientes | pedir para conectar o Google Sheets com uma conta que acesse a planilha |
| Google Drive (conector) | `search_files` com `parentId = '<pasta de pedidos>'` | pedir para conectar o Google Drive com uma conta que veja as pastas (de preferência a conta dona dos arquivos) |
| Navegador (Claude no Chrome ou navegador do app) | listar as abas | pedir para abrir o navegador com a extensão; usar o navegador que estiver disponível |

- Não usar o navegador para o Drive nem para a planilha. Ele serve só para o portal SulAmérica.
- Usar a conta que estiver conectada no momento. Nunca citar ou fixar uma conta específica.

### 0.3 Registro de saída
- Se a configuração trouxer a planilha e a pasta de registro, usar essas.
- Se não trouxer, **perguntar antes de criar**. Com o OK:
  - criar a pasta "Skill SP-SADT Sulamerica (feito pelo Claude)" no Drive conectado, com a descrição "Pasta criada pelo Claude (IA) via skill SP/SADT Sulamerica";
  - dentro dela, criar a planilha "Registro SP-SADT Sulamerica (Claude)", com a aba `Registro`, a linha 1 congelada e o cabeçalho abaixo;
  - devolver os dois links ao usuário para ele colar na configuração das próximas rodadas.
- Cabeçalho (A–P): Data/hora · Paciente · Carteirinha · Médico solicitante · CRM · CBO · CID · Procedimento · Qtde · Anexos · Nº da Guia · Senha · Status · Feito por · Aprovado por (humano) · Observações.

### 0.4 Login no portal
Abrir `https://saude.sulamericaseguros.com.br/prestador/login/` no Chrome do usuário, preencher o "Código referenciado" com o código do prestador da configuração, deixar o cursor em "Usuário" e pedir ao usuário para fazer o login. A sessão dura cerca de 30 minutos, então rodar todos os pacientes logo em seguida.

## Etapa 1: dados de cada paciente (Google Sheets)
- `get_spreadsheet` (fields `sheets.properties.title`) para listar as abas; `get_values` em `<aba>!A1:Z200`.
- Achar o paciente pelo nome na coluna de paciente. O nome da aba NÃO é confiável: procurar em todas.
- Limpar prefixos e ";" (ex.: "Dr;Nome" → Nome, "CRM;61458" → 61458, "CBO;225124" → 225124, "CID ;F41" → F41).
- Carteirinha: 20 dígitos, sem espaços.

## Etapa 2: anexos (Google Drive)
1. Buscar com `search_files`: `title contains '<SOBRENOME>'` e também `parentId = '<pasta>'` nas pastas de pedidos e relatórios e nas subpastas delas, paginando com `pageToken`.
2. Identificar o arquivo pelo **nome do paciente no arquivo**, não pelo nome da pasta (pastas podem estar trocadas). Confirmar com `get_file_metadata`.
3. `download_file_content(fileId)`. O resultado grande é salvo como JSON {content (base64), title, mimeType}. Decodificar com Python para `<diretório de trabalho>/anexos/<título>.pdf` e conferir que começa com `%PDF` (ou é jpg/jpeg).
4. O upload do navegador só aceita arquivos do diretório de trabalho da sessão. Pastas de saída (ex.: `/mnt/user-data/outputs`) são recusadas.
5. Arquivo não encontrado → NÃO enviar a guia desse paciente. Registrar "Arquivo não encontrado no Drive" na planilha de registro e no resumo.

## Etapa 3: preenchimento no portal (navegador) — MODO RÁPIDO (padrão)
Meta: 1 a 2 minutos por guia. Regra de ouro: poucas idas e voltas. Usar `browser_batch` para cliques em sequência e um único `javascript_tool` para preencher a ficha; nada de screenshot a cada campo (só a conferência final).
1. **Beneficiário:** navegar para `.../validacao-de-procedimentos/solicitacao/`; preencher por javascript os campos `codigo-beneficiario-1` a `-5` (blocos 3-5-4-4-4 da carteirinha). O botão "Ok" é um link `javascript:;` que NÃO responde a `.click()` por script: clicar com o mouse (achar com `find` "Ok link next to beneficiary code"). Conferir o nome do beneficiário na página (get_page_text ou javascript) contra o da rodada.
2. **Eletivo → SP/SADT:** dois cliques reais num só `browser_batch` (botão "Eletivo" e depois "SP/SADT"; achar com `find` se a posição mudar). A URL vira `.../solicitacao-de-sp-sadt.htm`.
3. **Ficha inteira num só passo:** rodar com `javascript_tool` o script abaixo, trocando os valores de `G` pelos da guia (carteirinha, médico, CRM, UF em código IBGE — SP=35, CBO, data da rodada dd/mm/aaaa, procedimento, quantidade, CID). Ele preenche tudo, escolhe a sugestão do CBO, inclui o procedimento, ajusta a quantidade e devolve um resumo. **Conferir o resumo** contra a linha aprovada; se algo não bater, corrigir só aquele campo (ou cair no modo manual abaixo).
```js
// Preenchimento rápido da Solicitação SP/SADT no portal SulAmérica (testado em 24/10/2026).
// Rodar com javascript_tool na página solicitacao-de-sp-sadt.htm, trocando os valores de G.
// Não clica em Validar nem em Confirmar: devolve um resumo para conferir.
const G = { guia: '<CARTEIRINHA 20 DIGITOS>', medico: '<NOME DO MEDICO>', crm: '<CRM>', ufIbge: '35', cbo: '<CBO>',
            data: '<DD/MM/AAAA>', proc: '50000470', qtde: '<QTDE>', cid: '<CID>' };
const $j = jQuery, espera = (ms) => new Promise((r) => setTimeout(r, ms));
const N = (n) => document.getElementsByName('solicitacao-sp-sadt.' + n)[0] || document.getElementsByName(n)[0];
const set = (el, v) => { el.focus(); el.value = v; ['input', 'change', 'keyup', 'blur'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true }))); $j(el).trigger('change'); return el.value; };
set(N('numero-guia-prestador'), G.guia);
set(N('executante-solicitante.nome-profissional-solicitante'), G.medico.toUpperCase());
set(document.getElementById('conselho-profissional'), '06');            // CRM
set(N('executante-solicitante.conselho-profissional.numero'), G.crm);
set(document.getElementById('uf-conselho-profissional'), G.ufIbge);    // código IBGE: SP = 35
set(N('atendimento.data-atendimento'), G.data);
set(document.getElementById('recem-nato'), 'false');
set([...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.trim() === 'Convencional')), '1');
set(N('descricao-indicacao-clinica'), 'CID 10 ' + G.cid);
// CBO: digitar e escolher a sugestão (obrigatório)
$j('#busca-codigo-cbo').focus().val(G.cbo).trigger('keydown').trigger('keyup').trigger('input');
let item = null;
for (let i = 0; i < 20 && !item; i++) { await espera(250); item = [...document.querySelectorAll('.ui-autocomplete li, .ui-menu-item, [role=option]')].find((e) => e.offsetParent && e.textContent.trim().startsWith(G.cbo)); }
if (item) { const a = item.querySelector('a,div') || item; ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach((t) => a.dispatchEvent(new MouseEvent(t, { bubbles: true }))); }
await espera(500);
// Procedimento + quantidade
$j('[name="codigo-procedimento"]').focus().val(G.proc).trigger('input').trigger('keyup').trigger('change').trigger('blur');
await espera(600);
$j('#btn-incluir-procedimento').trigger('click');
for (let i = 0; i < 20 && !$j('[name="quantidade-solicitada"]').length; i++) await espera(250);
$j('[name="quantidade-solicitada"]').first().focus().val(String(G.qtde)).trigger('input').trigger('keyup').trigger('change').trigger('blur');
await espera(300);
const itens = JSON.parse($j('[name$="lista-itens-solicitacao-sp-sadt"]').val() || '[]');
({
  guia: N('numero-guia-prestador').value.length + ' dígitos', medico: N('executante-solicitante.nome-profissional-solicitante').value,
  conselho: document.getElementById('conselho-profissional').value, crm: N('executante-solicitante.conselho-profissional.numero').value,
  uf: document.getElementById('uf-conselho-profissional').value, cbo: N('executante-solicitante.cbo.codigo').value,
  data: N('atendimento.data-atendimento').value, indicacao: N('descricao-indicacao-clinica').value,
  procedimentos: itens.map((i) => i.servico.codigo + ' x' + i['quantidade-solicitada']),
});
```
4. **Anexos:** com os arquivos recebidos pela ponte (`window.__arqs`), para cada um: `const dt = new DataTransfer(); dt.items.add(new File([a.buf], a.nome, { type: a.tipo })); const inp = document.getElementById('upload-item'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));` → `jQuery('#anexos-tipo-documento').val(a.doc).trigger('change'); jQuery('#btn-anexar').trigger('click')` → esperar ~2 s. Conferir que a tabela com cabeçalho Arquivo/Observação/Tamanho/Ação lista os 2 arquivos (procurar pela tabela cujo texto contém "Arquivo" e "Tamanho" e "visualizar"). (Tipos: 3 = Pedido do profissional de saúde, 4 = Relatório do profissional de saúde.)
5. **Validar e Confirmar** (só guias aprovadas): `jQuery('#btn-validar-procedimento').trigger('click')`, esperar a resposta, ler o retorno; se ok, `jQuery('#btn-confirmar-solicitacao').trigger('click')`. Se o clique por script não responder, clicar com o mouse (achar com `find`). Ler Nº da guia, senha e status com get_page_text e gravar na plataforma. Voltar para o passo 1 com a próxima guia.
6. **Imprimir a guia (se `sps_config.imprimir_guia` for verdadeiro, padrão sim):** na página de protocolo que aparece depois do Confirmar, clicar em **"Visualizar Guia"** (achar com `find`). Na guia aberta, apertar `ctrl+p` (ação `key`), esperar ~3 s a prévia carregar e apertar `Enter` para imprimir no destino já selecionado no Chrome. Gravar `impressa_em = now()` no item. Se a prévia não abrir ou não der para confirmar, deixar a guia aberta e avisar na tabela final ("guia aberta para imprimir"). O Chrome usa o último destino escolhido: na primeira vez, pedir ao usuário para escolher a impressora padrão na prévia, que fica guardada.
7. Um screenshot só por guia, se o retorno do portal for ambíguo.

## Etapa 3-B: modo manual (se o script falhar ou o portal mudar)
1. Ir direto para `https://saude.sulamericaseguros.com.br/prestador/segurado/validacao-de-procedimentos-tiss-3/validacao-de-procedimentos/solicitacao/` (o link do menu às vezes não navega).
2. Carteirinha em 5 campos, nos blocos 3-5-4-4-4 dígitos → Ok. Conferir o nome exibido com o da planilha.
3. Clicar no botão do caráter da configuração (padrão "Eletivo") → "SP/SADT".
4. Campos (preencher em lote):

| Campo | Valor | Como |
|---|---|---|
| Número da Guia no Prestador | carteirinha, 20 dígitos | clicar + digitar (preencher direto arredonda como número) |
| Contratado / Número | código do prestador da configuração (o portal já preenche) | conferir; se divergir, parar e avisar |
| Nome do Profissional Solicitante | médico, em maiúsculas | preencher |
| Conselho Profissional | CRM | selecionar |
| UF | UF padrão da configuração | selecionar |
| Número do Conselho | CRM | preencher |
| Código e descrição CBO | CBO | clicar no campo, digitar, esperar 2 s e clicar na sugestão "<CBO> - ..." (é obrigatório escolher a sugestão) |
| Data do Atendimento | modo plataforma: `sps_rodadas.data` (data da rodada); modo planilha: data informada na configuração ou hoje — em dd/mm/aaaa | clicar + digitar |
| Recém-nato | da configuração (padrão Não) | selecionar |
| Caráter do Atendimento | da configuração (já vem preenchido) | conferir |
| Técnica Utilizada | da configuração (padrão Convencional) | selecionar |
| Procedimento | procedimento da configuração (ou o informado para o paciente) | digitar o código + "Incluir" |
| Qt. Solic. | modo plataforma: `sps_rodada_itens.qtde`; modo planilha: quantidade da configuração | ajustar na linha do procedimento |
| Indicação Clínica | "CID 10 <CID>" | clicar + digitar |

5. Anexos (seção "Anexar Arquivos"), um de cada vez:
   - upload do relatório no campo "Procurar" → Tipo Documento "Relatório do profissional de saúde" → "Anexar" → esperar;
   - upload do pedido → "Pedido do profissional de saúde" → "Anexar";
   - conferir a tabela Arquivo/Tamanho com os 2 arquivos. Formatos aceitos: jpg, jpeg ou pdf, até 10 MB, nome só com letras, números, espaço e acentos.
6. Conferir o texto da Indicação Clínica (textarea `solicitacao-sp-sadt.descricao-indicacao-clinica`) e tirar um screenshot.
7. Gravar o status "Preenchida, aguardando aprovação" (na plataforma ou na planilha de registro).
8. Conferir que tudo na tela bate com a linha aprovada na tabela de conferência. Se bater e a guia estiver aprovada: "Validar Solicitação" → "Confirmar". Pegar o Número da Guia, a Senha e o Status (ex.: Autorizado). Se não houver aprovação em lote (pedido avulso), PARAR aqui e pedir o OK.

## Etapa 4: registro (autoria do Claude)
- Uma linha por paciente na aba `Registro` (ler `Registro!A:A` para achar a próxima linha vazia).
- Depois de confirmar, atualizar a mesma linha com Nº da Guia, Senha e Status do portal, e "Aprovado por" = aprovador da configuração (ou quem deu o OK).
- Em erro ou arquivo faltando: Status "Não enviada" e o motivo em Observações.
- "Feito por" = sempre "Claude (IA)". Linhas de pessoas usam "Humano".
- Carteirinha e guia como texto (prefixar com ' ) para não virarem número.
- Arquivos gerados (ex.: PDF da VPP) vão para a pasta de saída com "(Claude)" no nome e a descrição "Gerado pelo Claude (IA) via skill SP/SADT Sulamerica".

## Saída final no chat
Tabela: Paciente · Procedimento · Qtde · Nº da Guia · Senha · Status · Observações, mais o link da planilha de registro. Lembrar o usuário de guardar a configuração para a próxima rodada.

## Problemas conhecidos
- A sessão do portal expira (~30 min) e volta para o login: pedir novo login e recomeçar o paciente atual. Antes de recomeçar, conferir no portal (consulta de solicitações) se a guia daquele paciente já foi criada, para não duplicar.
- O navegador às vezes desconecta: pedir para deixar o Chrome aberto e tentar de novo.
- Tela aberta no navegador embutido do app em vez do Chrome: o usuário não vê. Reabrir no Chrome dele e fechar a do app.
- Portal abre na tela de login com `accessError=2` numa aba nova: o login do portal é por aba. Usar a aba que já está logada (ou pedir login nela).
- Plataforma em outro endereço (ex.: versão antiga): o comando traz o `site`; usar sempre esse endereço.
- A busca do Drive só enxerga o que a conta conectada consegue ver. Se não achar arquivos que existem, pedir para conectar o Drive com a conta dona das pastas.
