/**
 * SP/SADT Sulamerica — monta a pasta "SULAMERICA - COMPLETOS"
 * Copia só os pacientes que estão na planilha E têm pedido médico E relatório.
 * Gera também uma planilha de conferência com quem ficou de fora e o motivo.
 *
 * Como usar: script.google.com → Novo projeto → apague o conteúdo → cole este código →
 * salve → escolha a função "montarPastaCompletos" → Executar → autorize.
 * Se aparecer "PAUSADO", clique em Executar de novo: ele continua de onde parou.
 */

// >>> É ESTA que você executa (já vem selecionada no menu ao lado do botão "Executar") <<<
function EXECUTAR_AQUI() { return montarPastaCompletos(); }

// ====== CONFIGURAÇÃO (links das suas pastas e planilha) ======
const PLANILHA_PACIENTES = '1cHD3MyJF8ZceOeekmXNmrrx01hvBLdHcg4eq07nelZQ';
const PASTA_SULAMERICA   = '1AtsbxteruC8LE9ipmeqkxqLfi-PmYZ4L'; // contém PEDIDO MEDICO e RELATORIOS
const NOME_PASTA_DESTINO = 'SULAMERICA - COMPLETOS';
// =============================================================

const LIMITE_MS = 5 * 60 * 1000; // o Google corta em 6 min; paramos antes e continuamos na próxima execução
const STOP = new Set(['de','da','do','das','dos','e','pedido','pedidos','medico','medica','relatorio','relatorios','pdf','jpg','jpeg','png','scan','copia','doc','encaminhamento']);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\(\d+\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(s) { return norm(s).split(' ').filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)); }

// ---------- Planilha: mesma leitura do site (procura a carteirinha de 15–22 dígitos em cada linha) ----------
function lerPacientes() {
  const ss = SpreadsheetApp.openById(PLANILHA_PACIENTES);
  const out = [], vistos = new Set();
  ss.getSheets().forEach(aba => {
    const rows = aba.getDataRange().getDisplayValues();
    rows.forEach(row => {
      const cells = row.map(c => String(c || '').trim());
      const iCart = cells.findIndex(c => /^\d{15,22}$/.test(c.replace(/[\s.\-]/g, '')));
      if (iCart < 0) return;
      const nome = cells.slice(0, iCart).reverse().find(c => /[A-Za-zÀ-ú]{2,}/.test(c));
      if (!nome) return;
      const n = norm(nome);
      if (vistos.has(n)) return;
      vistos.add(n);
      const l = tokens(nome);
      out.push({ nome: nome.replace(/\s+/g, ' ').trim().toUpperCase(), aba: aba.getName().trim(), abaNorm: norm(aba.getName()), tl: l, ts: new Set(l), arquivos: { pedido: [], relatorio: [] } });
    });
  });
  return out;
}

// ---------- Ligação arquivo → paciente (mesma regra do site) ----------
function pontua(nomeArquivo, pacientes) {
  const ft = tokens(String(nomeArquivo).replace(/\.[a-z0-9]+$/i, ''));
  let melhor = null, score = 0, segundo = 0;
  pacientes.forEach(p => {
    let s = 0;
    ft.forEach(t => {
      if (p.ts.has(t)) s += t.length >= 4 ? 2 : 1;
      else if (t.length >= 4 && p.tl.some(q => q.length >= 4 && (q.startsWith(t) || t.startsWith(q)))) s += 1;
    });
    if (ft[0] && p.tl[0] === ft[0]) s += 2;
    if (s > score) { segundo = score; score = s; melhor = p; } else if (s > segundo) segundo = s;
  });
  return { paciente: score >= 4 ? melhor : null, score, folga: score - segundo };
}
function acharPaciente(nomeArquivo, pastas, pacientes) {
  const geral = pontua(nomeArquivo, pacientes);
  const pastasNorm = new Set(pastas.map(norm));
  const daAba = pacientes.filter(p => pastasNorm.has(p.abaNorm));
  if (daAba.length) {
    const r = pontua(nomeArquivo, daAba);
    if (r.paciente && (!geral.paciente || r.score >= geral.score)) return r;
  }
  return geral;
}
function tipoDoArquivo(pastas, nome) {
  const p = norm(pastas.join(' '));
  if (/relat/.test(p)) return 'relatorio';
  if (/pedido|encaminh/.test(p)) return 'pedido';
  const n = norm(nome);
  return /relat/.test(n) ? 'relatorio' : /pedido|encaminh|solicit/.test(n) ? 'pedido' : null;
}
const ACEITOS = /\.(pdf|jpe?g|png|heic|heif|webp|gif|bmp|jfif)$/i;

// ---------- Percorre todas as subpastas ----------
function listarArquivos(pasta, caminho, saida) {
  const arqs = pasta.getFiles();
  while (arqs.hasNext()) {
    const f = arqs.next();
    saida.push({ id: f.getId(), nome: f.getName(), caminho: caminho.slice(), atualizado: f.getLastUpdated().getTime(), tamanho: f.getSize() });
  }
  const subs = pasta.getFolders();
  while (subs.hasNext()) { const s = subs.next(); listarArquivos(s, caminho.concat([s.getName()]), saida); }
}

function pastaFilha(pai, nome) {
  const it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

// ---------- Principal ----------
function montarPastaCompletos() {
  const inicio = Date.now();
  const raiz = DriveApp.getFolderById(PASTA_SULAMERICA);

  // espaço disponível (as cópias ocupam o armazenamento de quem roda o script)
  const limite = DriveApp.getStorageLimit(), usado = DriveApp.getStorageUsed();

  const pacientes = lerPacientes();
  const todos = [];
  const subs = raiz.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    if (norm(s.getName()) === norm(NOME_PASTA_DESTINO)) continue; // não reler a pasta de saída
    listarArquivos(s, [s.getName()], todos);
  }

  const semPaciente = [], formatoNaoAceito = [];
  todos.forEach(a => {
    if (!ACEITOS.test(a.nome)) { formatoNaoAceito.push(a); return; }
    const tipo = tipoDoArquivo(a.caminho, a.nome);
    const r = acharPaciente(a.nome, a.caminho, pacientes);
    if (!r.paciente || !tipo) { semPaciente.push(Object.assign(a, { tipo: tipo || '?' })); return; }
    r.paciente.arquivos[tipo].push(a);
  });

  const completos = pacientes.filter(p => p.arquivos.pedido.length && p.arquivos.relatorio.length);
  const bytesNecessarios = completos.reduce((s, p) => s + p.arquivos.pedido.concat(p.arquivos.relatorio).reduce((t, a) => t + a.tamanho, 0), 0);
  if (limite > 0 && usado + bytesNecessarios > limite) {
    throw new Error('Espaço insuficiente no Google Drive desta conta: precisa de ~' + Math.round(bytesNecessarios / 1048576) +
      ' MB e restam ' + Math.round((limite - usado) / 1048576) + ' MB. Rode o script logado na conta dona dos arquivos (ou libere espaço).');
  }

  // Pasta de saída: SULAMERICA - COMPLETOS / PEDIDO MEDICO|RELATORIOS / <aba do profissional> / arquivos
  // Tenta criar dentro de SULAMERICA; se a conta só puder ver essa pasta, cria no "Meu Drive" de quem roda
  let destino;
  try { destino = pastaFilha(raiz, NOME_PASTA_DESTINO); }
  catch (e) { destino = pastaFilha(DriveApp.getRootFolder(), NOME_PASTA_DESTINO); }
  const dPed = pastaFilha(destino, 'PEDIDO MEDICO'), dRel = pastaFilha(destino, 'RELATORIOS');
  destino.setDescription('Criada pelo script SP/SADT Sulamerica (Claude). Só pacientes da planilha com pedido E relatório.');
  const jaCopiados = new Set();
  [dPed, dRel].forEach(d => { const it = d.getFolders(); while (it.hasNext()) { const f = it.next().getFiles(); while (f.hasNext()) jaCopiados.add(f.next().getDescription() || ''); } });

  let copiados = 0, pausado = false;
  for (const p of completos) {
    for (const tipo of ['pedido', 'relatorio']) {
      const pastaTipo = pastaFilha(tipo === 'pedido' ? dPed : dRel, p.aba);
      for (const a of p.arquivos[tipo]) {
        if (jaCopiados.has('origem:' + a.id)) continue;
        if (Date.now() - inicio > LIMITE_MS) { pausado = true; break; }
        const copia = DriveApp.getFileById(a.id).makeCopy(a.nome, pastaTipo);
        copia.setDescription('origem:' + a.id);
        jaCopiados.add('origem:' + a.id); copiados++;
      }
      if (pausado) break;
    }
    if (pausado) break;
  }

  // Planilha de conferência
  const rel = conferencia(destino, pacientes, semPaciente, formatoNaoAceito);
  const msg = (pausado ? 'PAUSADO (limite de tempo do Google): clique em Executar de novo para continuar. ' : 'CONCLUÍDO. ') +
    copiados + ' arquivos copiados nesta execução. ' + completos.length + ' pacientes completos de ' + pacientes.length +
    ' na planilha. Conferência: ' + rel.getUrl() + ' · Pasta: ' + destino.getUrl();
  Logger.log(msg);
  return msg;
}

// =====================================================================
// ENVIAR A PASTA "SULAMERICA - COMPLETOS" PARA A PLATAFORMA
// 1) Cole a chave de importação entre as aspas abaixo (ela vale 24 h).
// 2) No menu ao lado de "Executar", escolha ENVIAR_PARA_PLATAFORMA → Executar.
// Se não terminar em 5 min, ele se agenda sozinho e continua a cada minuto até acabar.
// =====================================================================
const CHAVE_IMPORTACAO = 'COLE_A_CHAVE_AQUI';
const URL_IMPORTACAO = 'https://ypcunysgtzdgqamkygtz.supabase.co/functions/v1/sps-importar';

function ENVIAR_PARA_PLATAFORMA() { return enviarParaPlataforma(); }

function enviarParaPlataforma() {
  const inicio = Date.now();
  if (!CHAVE_IMPORTACAO || CHAVE_IMPORTACAO.indexOf('COLE') === 0) throw new Error('Cole a chave de importação na linha CHAVE_IMPORTACAO antes de executar.');
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'enviarParaPlataforma') ScriptApp.deleteTrigger(t); });

  let destino = null;
  const it = DriveApp.getFoldersByName(NOME_PASTA_DESTINO);
  while (it.hasNext()) { const f = it.next(); if (f.getFoldersByName('PEDIDO MEDICO').hasNext()) { destino = f; break; } }
  if (!destino) throw new Error('Não achei a pasta "' + NOME_PASTA_DESTINO + '". Rode EXECUTAR_AQUI primeiro.');

  const pacientes = lerPacientes();
  const arquivos = [];
  ['PEDIDO MEDICO', 'RELATORIOS'].forEach(nomeTipo => {
    const p = destino.getFoldersByName(nomeTipo);
    if (p.hasNext()) listarArquivos(p.next(), [nomeTipo], arquivos);
  });

  const cont = { ok: 0, ja_existe: 0, sem_paciente: 0, grande_demais: 0, erro: 0, pulados: 0 };
  const problemas = [];
  let pausado = false;
  for (const a of arquivos) {
    const f = DriveApp.getFileById(a.id);
    const desc = f.getDescription() || '';
    if (desc.indexOf('[plataforma]') >= 0) { cont.pulados++; continue; }
    if (Date.now() - inicio > LIMITE_MS) { pausado = true; break; }
    const tipo = tipoDoArquivo(a.caminho, a.nome);
    const r = acharPaciente(a.nome, a.caminho, pacientes);
    if (!tipo || !r.paciente) { cont.sem_paciente++; problemas.push(a.nome + ' — paciente/tipo não identificado'); continue; }

    let blob = f.getBlob(), mime = blob.getContentType(), nome = a.nome;
    try {
      if (mime !== 'application/pdf' && mime !== 'image/jpeg') {
        blob = blob.getAs('image/jpeg'); mime = 'image/jpeg'; nome = nome.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
      }
    } catch (e) { cont.erro++; problemas.push(a.nome + ' — não consegui converter para JPG'); continue; }
    if (blob.getBytes().length > 10 * 1024 * 1024) { cont.grande_demais++; problemas.push(a.nome + ' — maior que 10 MB'); continue; }

    let res;
    try {
      res = UrlFetchApp.fetch(URL_IMPORTACAO, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-import-key': CHAVE_IMPORTACAO },
        payload: JSON.stringify({ paciente: r.paciente.nome, tipo: tipo, nomeArquivo: nome, mime: mime, conteudoBase64: Utilities.base64Encode(blob.getBytes()) })
      });
    } catch (e) { cont.erro++; problemas.push(a.nome + ' — falha de rede: ' + e.message); continue; }
    const code = res.getResponseCode();
    let corpo = {}; try { corpo = JSON.parse(res.getContentText()); } catch (e) {}
    if (code === 401) throw new Error('A plataforma recusou a chave (' + (corpo.erro || code) + '). Peça uma chave nova ao Claude.');
    if (code !== 200) { cont.erro++; problemas.push(a.nome + ' — ' + (corpo.erro || ('HTTP ' + code))); continue; }
    cont[corpo.status] = (cont[corpo.status] || 0) + 1;
    if (corpo.status === 'ok' || corpo.status === 'ja_existe') f.setDescription(desc + ' [plataforma]');
    else problemas.push(a.nome + ' — ' + corpo.status + ' (' + r.paciente.nome + ')');
  }

  if (pausado) ScriptApp.newTrigger('enviarParaPlataforma').timeBased().after(60 * 1000).create();
  const msg = (pausado ? 'CONTINUA SOZINHO em 1 min (limite de tempo do Google). ' : 'CONCLUÍDO. ') +
    'Enviados agora: ' + cont.ok + ' · já estavam na plataforma: ' + cont.ja_existe + ' · já enviados antes: ' + cont.pulados +
    ' · paciente não achado: ' + cont.sem_paciente + ' · >10MB: ' + cont.grande_demais + ' · erros: ' + cont.erro +
    ' · total de arquivos: ' + arquivos.length + (problemas.length ? '\nProblemas:\n' + problemas.join('\n') : '');
  Logger.log(msg);
  return msg;
}

function conferencia(destino, pacientes, semPaciente, formatoNaoAceito) {
  const nome = 'Conferência - SULAMERICA COMPLETOS';
  const it = destino.getFilesByName(nome);
  let ss;
  if (it.hasNext()) ss = SpreadsheetApp.open(it.next());
  else { ss = SpreadsheetApp.create(nome); DriveApp.getFileById(ss.getId()).moveTo(destino); }

  const sh1 = ss.getSheets()[0]; sh1.setName('Pacientes'); sh1.clear();
  const linhas = [['Paciente', 'Aba (profissional)', 'Pedidos', 'Relatórios', 'Situação']].concat(
    pacientes.map(p => {
      const np = p.arquivos.pedido.length, nr = p.arquivos.relatorio.length;
      const sit = np && nr ? 'Completo (copiado)' : !np && !nr ? 'Sem pedido e sem relatório' : !np ? 'Falta pedido' : 'Falta relatório';
      return [p.nome, p.aba, np, nr, sit];
    }).sort((a, b) => a[4].localeCompare(b[4]) || a[0].localeCompare(b[0])));
  sh1.getRange(1, 1, linhas.length, 5).setValues(linhas);
  sh1.setFrozenRows(1); sh1.getRange(1, 1, 1, 5).setFontWeight('bold');

  let sh2 = ss.getSheetByName('Arquivos sem paciente') || ss.insertSheet('Arquivos sem paciente'); sh2.clear();
  const l2 = [['Arquivo', 'Pasta', 'Tipo', 'Motivo']]
    .concat(semPaciente.map(a => [a.nome, a.caminho.join(' / '), a.tipo, 'Paciente não encontrado na planilha (não existe mais ou nome diferente)']))
    .concat(formatoNaoAceito.map(a => [a.nome, a.caminho.join(' / '), '-', 'Formato não aceito pelo portal (salve como PDF)']));
  sh2.getRange(1, 1, l2.length, 4).setValues(l2);
  sh2.setFrozenRows(1); sh2.getRange(1, 1, 1, 4).setFontWeight('bold');
  return ss;
}
