import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { norm, parseAbas, melhorPacienteComPasta, tipoPeloCaminho, classificaArquivo } from './parse.js';

const SUPABASE_URL = 'https://ypcunysgtzdgqamkygtz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Zl11bOWU5l3V7Nky3TNf-g_HBeFoNU8';
const BUCKET = 'sps-documentos';
// Cliente só para login. A renovação é feita por um temporizador próprio, baseado na validade
// que o servidor informa (expires_in), e não no relógio do computador, que pode estar errado.
const sa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sps-auth' } });
let sessao = null, tRecebida = 0, timerRenova = null, renovando = null;
// Cliente para dados e arquivos: usa sempre o token guardado, sem tentar renovar sozinho
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { accessToken: async () => sessao?.access_token ?? null });

function guardarSessao(s) {
  sessao = s; tRecebida = Date.now();
  clearTimeout(timerRenova);
  if (s) {
    const vida = (s.expires_in || 3600) * 1000;
    timerRenova = setTimeout(() => renovar().catch(() => sessaoExpirada()), Math.max(5000, vida * 0.7));
  }
}
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
function renovar() {
  if (!sessao?.refresh_token) return Promise.reject(new Error('sem sessão'));
  if (!renovando) {
    renovando = (async () => {
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        const { data, error } = await sa.auth.refreshSession({ refresh_token: sessao.refresh_token });
        if (!error && data.session) { guardarSessao(data.session); return true; }
        if (error?.status === 429) { await espera(4000 * (tentativa + 1)); continue; } // limite do Supabase: espera e tenta de novo
        throw error || new Error('sem sessão');
      }
      throw new Error('limite de tentativas');
    })().finally(() => { renovando = null; });
  }
  return renovando;
}

/* ---------- Sessão: renova quando precisa e volta ao login se cair (nunca mostra tela vazia) ---------- */
const ehErroDeSessao = (e) => !!e && (e.status === 401 || e.statusCode === '401' || e.statusCode === 401 || e.code === 'PGRST301' || e.code === '42501' ||
  /jwt|token|row-level security|not authorized|unauthorized|exp/i.test(e.message || ''));
async function garantirSessao(forcar = false) {
  if (!sessao) { sessaoExpirada(); return false; }
  const vida = (sessao.expires_in || 3600) * 1000;
  if (!forcar && Date.now() - tRecebida < vida * 0.8) return true;
  try { await renovar(); return true; } catch { sessaoExpirada(); return false; }
}
// Executa uma operação do Supabase; se falhar por sessão, renova e tenta mais uma vez
async function comSessao(fn) {
  if (!(await garantirSessao())) return { error: { message: 'Sessão expirada' }, sessao: false };
  let res = await fn();
  if (res?.error && ehErroDeSessao(res.error)) {
    await espera(800);
    if (!(await garantirSessao(true))) return { error: { message: 'Sessão expirada' }, sessao: false };
    res = await fn();
  }
  return res;
}
let avisouExpirou = false;
function sessaoExpirada() {
  if (avisouExpirou || !state.user) return;
  avisouExpirou = true; clearTimeout(timerRenova);
  $('#tela-app').classList.add('hidden');
  $('#tela-login').classList.remove('hidden');
  $('#login-email').value = state.user.email;
  $('#login-msg').className = 'msg err';
  $('#login-msg').textContent = 'Sua sessão expirou. Entre de novo: nada foi perdido, seus dados continuam salvos.';
  state.user = null;
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const kb = (n) => (n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const dt = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

let state = { user: null, pacientes: [], docs: [], rodadas: [], config: null };

function toast(msg, err = false) {
  const d = document.createElement('div');
  d.className = 'toast' + (err ? ' err' : '');
  d.textContent = msg;
  $('#toast').append(d);
  setTimeout(() => d.remove(), err ? 7000 : 3500);
}
async function log(acao, detalhes, autor_tipo = 'Humano') {
  await sb.from('sps_log').insert({ acao, detalhes, autor_tipo });
}

/* ---------------- AUTH ---------------- */
sa.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT' && state.user) sessaoExpirada(); });

async function iniciar() {
  avisoOutraAba();
  let guardada = null;
  try { guardada = JSON.parse(localStorage.getItem('sps-auth') || 'null'); } catch {}
  if (!guardada?.refresh_token) return $('#tela-login').classList.remove('hidden');
  sessao = guardada;
  try { await renovar(); } catch { sessao = null; await sa.auth.signOut({ scope: 'local' }); return $('#tela-login').classList.remove('hidden'); }
  entrar(sessao.user);
}

// Avisa se o site estiver aberto em mais de uma aba (abas disputam a renovação do login)
function avisoOutraAba() {
  if (!('BroadcastChannel' in window)) return;
  const canal = new BroadcastChannel('sps-abas'), id = Math.random().toString(36).slice(2);
  canal.onmessage = (e) => {
    if (e.data?.tipo === 'oi' && e.data.id !== id) { canal.postMessage({ tipo: 'estou-aqui', id }); mostrarAvisoAba(); }
    if (e.data?.tipo === 'estou-aqui' && e.data.id !== id) mostrarAvisoAba();
  };
  canal.postMessage({ tipo: 'oi', id });
}
function mostrarAvisoAba() {
  if ($('#aviso-aba')) return;
  const d = document.createElement('div');
  d.id = 'aviso-aba';
  d.className = 'aviso-aba';
  d.textContent = 'O site está aberto em outra aba. Feche as outras e use só esta, para não derrubar o login.';
  document.body.prepend(d);
}
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  msg.className = 'msg'; msg.textContent = 'Entrando…';
  const botao = e.submitter || $('#form-login button[type=submit]');
  if (botao.disabled) return;
  botao.disabled = true;
  const { data, error } = await sa.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-senha').value });
  if (!error && data.session) guardarSessao(data.session);
  botao.disabled = false;
  if (error && error.status === 429) { msg.className = 'msg err'; msg.textContent = 'Muitas tentativas seguidas. Aguarde 2 minutos e tente de novo (com só uma aba aberta).'; return; }
  if (error) { msg.className = 'msg err'; msg.textContent = error.message.includes('confirm') ? 'E-mail ainda não autorizado. Peça acesso ao administrador.' : 'E-mail ou senha incorretos.'; return; }
  entrar(data.user);
});
$('#btn-criar-conta').addEventListener('click', async () => {
  const email = $('#login-email').value.trim(), senha = $('#login-senha').value, msg = $('#login-msg');
  if (!email || senha.length < 8) { msg.className = 'msg err'; msg.textContent = 'Informe o e-mail autorizado e uma senha com 8+ caracteres.'; return; }
  const { data, error } = await sa.auth.signUp({ email, password: senha });
  if (!error && data.session) guardarSessao(data.session);
  if (error) { msg.className = 'msg err'; msg.textContent = error.message; return; }
  if (data.session) entrar(data.user);
  else { msg.className = 'msg'; msg.textContent = 'Conta criada. Se o seu e-mail estiver autorizado, já pode entrar.'; }
});
$('#btn-sair').addEventListener('click', async () => { clearTimeout(timerRenova); await sa.auth.signOut({ scope: 'local' }); location.reload(); });

async function entrar(user) {
  let { data: ok, error } = await sb.rpc('sps_is_member');
  if (error && ehErroDeSessao(error)) {
    await new Promise((r) => setTimeout(r, 1500));
    ({ data: ok, error } = await sb.rpc('sps_is_member'));
  }
  if (error || ok !== true) {
    $('#tela-app').classList.add('hidden');
    $('#tela-login').classList.remove('hidden');
    $('#login-email').value = user.email || '';
    $('#login-msg').className = 'msg err';
    $('#login-msg').textContent = error
      ? 'Não consegui confirmar seu acesso agora (sessão expirada ou muitas tentativas). Feche as outras abas, aguarde 2 minutos e entre de novo.'
      : 'Seu e-mail não está autorizado nesta plataforma.';
    clearTimeout(timerRenova); sessao = null;
    await sa.auth.signOut({ scope: 'local' }); // só esta aba; não derruba as outras sessões
    return;
  }
  state.user = user; avisouExpirou = false;
  $('#tela-login').classList.add('hidden');
  $('#tela-app').classList.remove('hidden');
  $('#user-email').textContent = user.email;
  $('#rodada-data').value = hoje();
  await recarregar();
}

/* ---------------- DATA ---------------- */
async function recarregar() {
  if (!(await garantirSessao())) return;
  const [p, d, r, c] = await Promise.all([
    sb.from('sps_pacientes').select('*').order('nome'),
    sb.from('sps_documentos').select('*').order('created_at', { ascending: false }),
    sb.from('sps_rodadas').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('sps_config').select('*').eq('id', 1).maybeSingle(),
  ]);
  if ([p, d, r, c].some((x) => ehErroDeSessao(x.error))) { if (await garantirSessao(true)) return recarregar(); return; }
  for (const x of [p, d, r, c]) if (x.error) toast(x.error.message, true);
  state.pacientes = p.data || []; state.docs = d.data || []; state.rodadas = r.data || []; state.config = c.data;
  renderStats(); renderRodada(); renderPacientes(); renderDocs(); renderSelRodada(); renderConfig();
}
function ultimoDoc(pid, tipo) { return state.docs.find((d) => d.paciente_id === pid && d.tipo === tipo); }

function renderStats() {
  $('#stat-pacientes').textContent = `${state.pacientes.filter((p) => p.ativo).length} pacientes cadastrados`;
  const ped = state.docs.filter((d) => d.tipo === 'pedido'), rel = state.docs.filter((d) => d.tipo === 'relatorio');
  $('#stat-pedidos').textContent = `${ped.length} pedidos · ${ped.filter((d) => !d.paciente_id).length} sem paciente`;
  $('#stat-relatorios').textContent = `${rel.length} relatórios · ${rel.filter((d) => !d.paciente_id).length} sem paciente`;
}

/* ---------------- TABS ---------------- */
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'painel') renderPainel();
}));

/* ---------------- PLANILHA ---------------- */
function parsePlanilha(wb) {
  return parseAbas(wb.SheetNames.map((nome) => ({ nome, rows: XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: '' }) })));
}
let previaPac = [];
$('#in-planilha').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    previaPac = parsePlanilha(wb);
    if (!previaPac.length) return toast('Nenhum paciente encontrado (procuro uma carteirinha de 20 dígitos em cada linha).', true);
    const existentes = new Set(state.pacientes.map((p) => p.nome_norm));
    const novos = previaPac.filter((p) => !existentes.has(p.nome_norm)).length;
    $('#planilha-resumo').textContent = `${previaPac.length} pacientes em ${wb.SheetNames.length} abas · ${novos} novos · ${previaPac.length - novos} serão atualizados.`;
    $('#tbl-prev-pac tbody').innerHTML = previaPac.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.carteirinha)}</td><td>${esc(p.medico)}</td><td>${esc(p.crm)}</td><td>${esc(p.cbo)}</td><td>${esc(p.cid)}</td><td>${esc(p.aba_origem)}</td></tr>`).join('');
    $('#dlg-planilha').showModal();
  } catch (err) { toast('Não consegui ler a planilha: ' + err.message, true); }
});
$('#pl-cancelar').addEventListener('click', () => $('#dlg-planilha').close());
$('#pl-salvar').addEventListener('click', async () => {
  const linhas = previaPac.map((p) => ({ ...p, ativo: true }));
  let error = null;
  for (let i = 0; i < linhas.length && !error; i += 200) {
    ({ error } = await comSessao(() => sb.from('sps_pacientes').upsert(linhas.slice(i, i + 200), { onConflict: 'nome_norm' })));
  }
  $('#dlg-planilha').close();
  if (error) return toast(error.message === 'Sessão expirada' ? 'Sessão expirada: entre de novo e importe outra vez.' : error.message, true);
  await log('importou_planilha', { pacientes: previaPac.length });
  toast(`${previaPac.length} pacientes importados.`);
  recarregar();
});

/* ---------------- DOCUMENTOS ---------------- */
const LIMITE = 10485760;
const nomeJpg = (n) => n.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
async function paraJpeg(file) {
  let blob = file;
  if (/\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type)) {
    const { default: heic2any } = await import('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm');
    blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    if (Array.isArray(blob)) blob = blob[0];
    if (blob.size <= LIMITE) return new File([blob], nomeJpg(file.name), { type: 'image/jpeg' });
  }
  const img = await createImageBitmap(blob);
  let escala = 1, qualidade = 0.9, saida;
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    saida = await new Promise((res) => c.toBlob(res, 'image/jpeg', qualidade));
    if (saida.size <= LIMITE) break;
    if (qualidade > 0.6) qualidade -= 0.15; else escala *= 0.75;
  }
  return new File([saida], nomeJpg(file.name), { type: 'image/jpeg' });
}

let filaArquivos = [], naoSuportados = [];
const caminhoDe = (f) => f.caminho || f.webkitRelativePath || f.name;

// entradas: lista de File (com webkitRelativePath ou .caminho); tipoPadrao: 'pedido' | 'relatorio' | null (detectar pela pasta)
function abrirLigacao(entradas, tipoPadrao) {
  if (!state.pacientes.length) return toast('Importe a planilha de pacientes primeiro.', true);
  const todos = [...entradas];
  const validos = todos.filter((f) => ['ok', 'converter'].includes(classificaArquivo(caminhoDe(f))));
  naoSuportados = todos.filter((f) => classificaArquivo(caminhoDe(f)) === 'nao_suportado').map(caminhoDe);
  const ignorados = naoSuportados.length;
  if (!validos.length) { if (ignorados) mostrarNaoSuportados(); return toast('Nenhum PDF ou imagem encontrado na seleção.', true); }
  const ativos = state.pacientes.filter((p) => p.ativo);
  const jaTem = new Set(state.docs.map((d) => `${norm(d.arquivo_nome)}|${d.tamanho}`));
  const nomesJa = new Set(state.docs.filter((d) => d.mime === 'image/jpeg').map((d) => norm(d.arquivo_nome)));
  filaArquivos = validos.map((f) => {
    const cam = caminhoDe(f);
    const r = melhorPacienteComPasta(cam, ativos);
    const dup = jaTem.has(`${norm(f.name)}|${f.size}`) || (classificaArquivo(cam) === 'converter' && nomesJa.has(norm(f.name)));
    const ehPdf = /\.pdf$/i.test(f.name);
    const converter = classificaArquivo(cam) === 'converter' || (!ehPdf && f.size > LIMITE);
    const grande = ehPdf && f.size > LIMITE;
    return { file: f, caminho: cam, pasta: cam.split('/').slice(0, -1).join(' / '), tipo: tipoPeloCaminho(cam, tipoPadrao || 'outro'), ...r, dup, grande, converter, incluir: !dup && !grande };
  });
  limiteLinhas = 150;
  $('#dlg-so-problemas').checked = filaArquivos.length > 150;
  renderLigacao(ignorados);
  $('#dlg-ligar').showModal();
}

let limiteLinhas = 150;
let opcoesCache = null;
function opcoesPacientes() {
  if (!opcoesCache) opcoesCache = `<option value="">— sem paciente —</option>` + state.pacientes.filter((p) => p.ativo).map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  return opcoesCache;
}
function renderLigacao(ignorados = 0) {
  opcoesCache = null;
  const soProb = $('#dlg-so-problemas').checked;
  const n = (fn) => filaArquivos.filter(fn).length;
  $('#dlg-titulo').textContent = `Conferir ${filaArquivos.length} arquivos`;
  $('#dlg-resumo').innerHTML = `${n((a) => a.tipo === 'pedido')} pedidos · ${n((a) => a.tipo === 'relatorio')} relatórios` +
    (n((a) => a.tipo === 'outro') ? ` · <b style="color:var(--bad)">${n((a) => a.tipo === 'outro')} sem tipo</b>` : '') +
    ` · ${n((a) => a.paciente)} ligados a pacientes · <b>${n((a) => !a.paciente)} sem paciente</b>` +
    (n((a) => a.dup) ? ` · ${n((a) => a.dup)} já importados (desmarcados)` : '') +
    (n((a) => a.converter) ? ` · ${n((a) => a.converter)} imagens serão convertidas para JPG` : '') +
    (n((a) => a.grande) ? ` · <b style="color:var(--bad)">${n((a) => a.grande)} PDFs acima de 10 MB</b>` : '') +
    (naoSuportados.length ? ` · <a href="#" id="ver-nao-sup">${naoSuportados.length} arquivos em formato não aceito</a>` : '');
  const visiveis = filaArquivos.map((a, i) => [a, i]).filter(([a]) => !soProb || !a.paciente || a.conf !== 'alta' || a.tipo === 'outro' || a.grande);
  const mostrar = visiveis.slice(0, limiteLinhas);
  $('#tbl-ligar tbody').innerHTML = mostrar.map(([a, i]) => {
    return `<tr class="${a.dup ? 'dup' : ''}">
    <td><input type="checkbox" data-inc="${i}" ${a.incluir ? 'checked' : ''} ${a.grande ? 'disabled' : ''}></td>
    <td>${esc(a.file.name)}${a.grande ? ' <span class="badge b-bad">PDF acima de 10 MB: reduza antes</span>' : ''}${a.converter ? ' <span class="badge b-warn">vira JPG</span>' : ''}${a.dup ? ' <span class="badge b-info">já importado</span>' : ''}<br><span class="muted">${kb(a.file.size)}</span></td>
    <td class="muted">${esc(a.pasta)}</td>
    <td><select data-tipo="${i}"><option value="pedido" ${a.tipo === 'pedido' ? 'selected' : ''}>Pedido</option><option value="relatorio" ${a.tipo === 'relatorio' ? 'selected' : ''}>Relatório</option><option value="outro" ${a.tipo === 'outro' ? 'selected' : ''}>Outro</option></select></td>
    <td><span class="pac-nome">${a.paciente ? esc(a.paciente.nome) : '<span class="muted">— sem paciente —</span>'}</span> <button type="button" class="btn small ghost" data-trocar="${i}">trocar</button></td>
    <td><span class="badge ${a.paciente && a.conf === 'alta' ? 'b-ok' : a.paciente ? 'b-warn' : 'b-bad'}">${a.paciente ? a.conf : 'sem paciente'}</span>${a.viaPasta ? ' <span class="muted" title="Achado entre os pacientes da pasta do profissional">pela pasta</span>' : ''}</td></tr>`;
  }).join('') + (visiveis.length > mostrar.length ? `<tr><td colspan="6"><button type="button" class="btn small" id="mais-linhas">Mostrar mais ${Math.min(500, visiveis.length - mostrar.length)} de ${visiveis.length - mostrar.length} restantes</button> <span class="muted">(os não exibidos também serão salvos)</span></td></tr>` : '') || '<tr><td colspan="6" class="muted">Nada para conferir.</td></tr>';
  $('#mais-linhas')?.addEventListener('click', () => { limiteLinhas += 500; renderLigacao(ignorados); });
  $$('#tbl-ligar [data-trocar]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.trocar, a = filaArquivos[i], td = b.parentElement;
    td.innerHTML = `<select>${opcoesPacientes()}</select>`;
    const sel = $('select', td); sel.value = a.paciente?.id || ''; sel.focus();
    sel.addEventListener('change', () => { a.paciente = state.pacientes.find((p) => p.id === sel.value) || null; a.conf = a.paciente ? 'alta' : 'baixa'; a.viaPasta = false; });
  }));
  $('#ver-nao-sup')?.addEventListener('click', (e) => { e.preventDefault(); mostrarNaoSuportados(); });
  $$('#tbl-ligar [data-inc]').forEach((c) => c.addEventListener('change', () => { filaArquivos[c.dataset.inc].incluir = c.checked; atualizaBotao(); }));
  $$('#tbl-ligar [data-tipo]').forEach((s) => s.addEventListener('change', () => { filaArquivos[s.dataset.tipo].tipo = s.value; }));
  atualizaBotao();
}
function mostrarNaoSuportados() {
  const lista = naoSuportados.slice(0, 200).map((c) => '• ' + c).join('\n');
  alert(`Estes ${naoSuportados.length} arquivos não foram importados porque o portal só aceita PDF ou imagem (JPG).\nAbra cada um e salve/exporte como PDF, depois importe de novo:\n\n${lista}${naoSuportados.length > 200 ? '\n…' : ''}`);
}
function atualizaBotao() { $('#dlg-salvar').textContent = `Salvar ${filaArquivos.filter((a) => a.incluir).length} arquivos`; }
$('#dlg-so-problemas').addEventListener('change', () => renderLigacao());
$('#dlg-todos').addEventListener('change', (e) => { filaArquivos.forEach((a) => { if (!a.grande) a.incluir = e.target.checked; }); renderLigacao(); });

// Botões: arquivos soltos e pasta inteira
const ligarInput = (id, tipo) => $(id).addEventListener('change', (e) => { abrirLigacao(e.target.files, tipo); e.target.value = ''; });
ligarInput('#in-pedidos', 'pedido');
ligarInput('#in-pedidos-pasta', 'pedido');
ligarInput('#in-relatorios', 'relatorio');
ligarInput('#in-relatorios-pasta', 'relatorio');
ligarInput('#in-pasta-geral', null);

// Arrastar e soltar pastas (lê subpastas recursivamente)
async function lerEntrada(entry, prefixo = '') {
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej));
    f.caminho = prefixo + f.name;
    return [f];
  }
  if (entry.isDirectory) {
    const leitor = entry.createReader(), filhos = [];
    for (;;) { const lote = await new Promise((res, rej) => leitor.readEntries(res, rej)); if (!lote.length) break; filhos.push(...lote); }
    const out = [];
    for (const c of filhos) out.push(...(await lerEntrada(c, prefixo + entry.name + '/')));
    return out;
  }
  return [];
}
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
dz.addEventListener('drop', async (e) => {
  e.preventDefault();
  const entradas = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entradas.length) return abrirLigacao(e.dataTransfer.files, null);
  toast('Lendo pastas…');
  const arquivos = [];
  for (const en of entradas) arquivos.push(...(await lerEntrada(en)));
  abrirLigacao(arquivos, null);
});

$('#dlg-cancelar').addEventListener('click', () => $('#dlg-ligar').close());
$('#dlg-salvar').addEventListener('click', async () => {
  const fila = filaArquivos.filter((a) => a.incluir);
  const semTipo = fila.filter((a) => a.tipo === 'outro').length;
  if (semTipo && !confirm(`${semTipo} arquivo(s) estão como "Outro" e não entram como pedido nem relatório. Salvar mesmo assim?`)) return;
  const btn = $('#dlg-salvar'); btn.disabled = true;
  let ok = 0, feitos = 0, parar = false; const falhas = [];
  const enviar = async (a) => {
    const nomeOriginal = a.file.name;
    if (a.converter) {
      try { a.file = await paraJpeg(a.file); }
      catch (err) { falhas.push(a.file.name + ': não consegui converter (' + err.message + ')'); return; }
      if (a.file.size > LIMITE) { falhas.push(a.file.name + ': continua acima de 10 MB'); return; }
    }
    const safe = norm(a.file.name.replace(/\.[a-z0-9]+$/i, '')).replace(/ /g, '-').slice(0, 80) + '.' + (a.file.name.split('.').pop() || 'pdf').toLowerCase();
    const path = `${a.paciente?.id || 'sem-paciente'}/${a.tipo}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
    const tipoMime = /\.pdf$/i.test(a.file.name) ? 'application/pdf' : 'image/jpeg';
    const up = await comSessao(() => sb.storage.from(BUCKET).upload(path, a.file, { contentType: tipoMime, upsert: true }));
    if (up.sessao === false) { parar = true; return; }
    if (up.error) { falhas.push(a.file.name + ': ' + up.error.message); return; }
    const ins = await comSessao(() => sb.from('sps_documentos').insert({ paciente_id: a.paciente?.id || null, tipo: a.tipo, arquivo_nome: nomeOriginal, storage_path: path, tamanho: a.file.size, mime: tipoMime }));
    if (ins.sessao === false) { parar = true; return; }
    if (ins.error) falhas.push(a.file.name + ': ' + ins.error.message); else ok++;
  };
  const filaEnvio = [...fila];
  const trabalhador = async () => { while (filaEnvio.length && !parar) { const a = filaEnvio.shift(); await enviar(a); feitos++; btn.textContent = `Enviando ${feitos}/${fila.length}…`; $('#dlg-resumo').innerHTML = `<b>Enviando ${feitos} de ${fila.length}</b> · ${ok} salvos · ${falhas.length} com erro. Não feche esta aba.<div class="barra"><span style="width:${Math.round(feitos / fila.length * 100)}%"></span></div>`; } };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  btn.disabled = false; $('#dlg-ligar').close();
  if (parar) { toast(`${ok} arquivos salvos antes da sessão expirar. Entre de novo e importe a pasta outra vez: os já salvos serão pulados.`, true); return; }
  await log('importou_documentos', { ok, falhas: falhas.length });
  toast(`${ok} arquivos salvos.` + (falhas.length ? ` ${falhas.length} falharam: ${falhas.slice(0, 3).join('; ')}${falhas.length > 3 ? '…' : ''}` : ''), !!falhas.length);
  recarregar();
});

async function abrirDoc(id) {
  const d = state.docs.find((x) => x.id === id);
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.storage_path, 300);
  if (error) return toast(error.message, true);
  window.open(data.signedUrl, '_blank', 'noopener');
}
window.abrirDoc = abrirDoc;

function renderDocs() {
  const q = norm($('#busca-doc').value);
  const pac = Object.fromEntries(state.pacientes.map((p) => [p.id, p]));
  const opts = (sel) => `<option value="">— sem paciente —</option>` + state.pacientes.map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
  $('#tbl-doc tbody').innerHTML = state.docs
    .filter((d) => !q || norm(d.arquivo_nome + ' ' + (pac[d.paciente_id]?.nome || '')).includes(q))
    .map((d) => `<tr>
      <td><a href="#" onclick="abrirDoc('${d.id}');return false">${esc(d.arquivo_nome)}</a></td>
      <td><span class="badge ${d.tipo === 'pedido' ? 'b-info' : 'b-ok'}">${d.tipo}</span></td>
      <td><select data-doc="${d.id}">${opts(d.paciente_id)}</select></td>
      <td>${kb(d.tamanho)}</td><td>${dt(d.created_at)}</td><td class="muted">${esc(d.created_by || '')}</td>
      <td><button class="btn small ghost" data-del="${d.id}">Remover</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum documento ainda.</td></tr>';
  $$('#tbl-doc select').forEach((s) => s.addEventListener('change', async () => {
    const { error } = await sb.from('sps_documentos').update({ paciente_id: s.value || null }).eq('id', s.dataset.doc);
    if (error) toast(error.message, true); else { toast('Paciente do documento atualizado.'); recarregar(); }
  }));
  $$('#tbl-doc [data-del]').forEach((b) => b.addEventListener('click', async () => {
    const d = state.docs.find((x) => x.id === b.dataset.del);
    if (!confirm(`Remover "${d.arquivo_nome}"?`)) return;
    const em = await sb.from('sps_rodada_itens').select('id').or(`pedido_id.eq.${d.id},relatorio_id.eq.${d.id}`).limit(1);
    if (em.data?.length) return toast('Este arquivo já está numa rodada e não pode ser removido.', true);
    await sb.storage.from(BUCKET).remove([d.storage_path]);
    const { error } = await sb.from('sps_documentos').delete().eq('id', d.id);
    if (error) return toast(error.message, true);
    await log('removeu_documento', { arquivo: d.arquivo_nome });
    recarregar();
  }));
}
$('#busca-doc').addEventListener('input', renderDocs);

/* ---------------- PACIENTES ---------------- */
function renderPacientes() {
  const q = norm($('#busca-pac').value);
  const campos = ['nome', 'carteirinha', 'medico', 'crm', 'crm_uf', 'cbo', 'cid'];
  $('#tbl-pac tbody').innerHTML = state.pacientes.filter((p) => !q || p.nome_norm.includes(q)).map((p) => `<tr data-id="${p.id}">
    ${campos.map((c) => `<td contenteditable data-c="${c}">${esc(p[c])}</td>`).join('')}
    <td class="muted">${esc(p.aba_origem)}</td>
    <td><input type="checkbox" data-ativo ${p.ativo ? 'checked' : ''}></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Importe a planilha na aba Rodada do dia.</td></tr>';
  $$('#tbl-pac td[contenteditable]').forEach((td) => td.addEventListener('blur', async () => {
    const id = td.parentElement.dataset.id, c = td.dataset.c, v = td.textContent.trim();
    const p = state.pacientes.find((x) => x.id === id);
    if (p[c] === v) return;
    const upd = { [c]: c === 'carteirinha' ? v.replace(/\D/g, '') : v };
    if (c === 'nome') upd.nome_norm = norm(v);
    const { error } = await sb.from('sps_pacientes').update(upd).eq('id', id);
    if (error) toast(error.message, true); else { Object.assign(p, upd); toast('Salvo.'); }
  }));
  $$('#tbl-pac [data-ativo]').forEach((ch) => ch.addEventListener('change', async () => {
    const id = ch.closest('tr').dataset.id;
    await sb.from('sps_pacientes').update({ ativo: ch.checked }).eq('id', id);
    state.pacientes.find((x) => x.id === id).ativo = ch.checked; renderRodada(); renderStats();
  }));
}
$('#busca-pac').addEventListener('input', renderPacientes);

/* ---------------- RODADA ---------------- */
const selecao = new Map(); // paciente_id -> qtde
function renderRodada() {
  const q = norm($('#busca-rodada').value);
  const lista = state.pacientes.filter((p) => p.ativo && (!q || p.nome_norm.includes(q)));
  const marca = (d) => (d ? `<a href="#" onclick="abrirDoc('${d.id}');return false" title="${esc(d.arquivo_nome)}"><span class="badge b-ok">✓ ver</span></a>` : '<span class="badge b-bad">falta</span>');
  $('#tbl-rodada tbody').innerHTML = lista.map((p) => {
    const ped = ultimoDoc(p.id, 'pedido'), rel = ultimoDoc(p.id, 'relatorio');
    return `<tr data-id="${p.id}">
      <td><input type="checkbox" data-sel ${selecao.has(p.id) ? 'checked' : ''}></td>
      <td><b>${esc(p.nome)}</b></td><td class="muted">${esc(p.carteirinha)}</td>
      <td>${esc(p.medico)}<br><span class="muted">CRM ${esc(p.crm)} ${esc(p.crm_uf)} · CBO ${esc(p.cbo)}</span></td>
      <td>${esc(p.cid)}</td><td>${marca(ped)}</td><td>${marca(rel)}</td>
      <td><input type="number" min="1" max="99" value="${selecao.get(p.id) || 1}" data-qtde></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">Nenhum paciente. Comece importando a planilha (passo 1).</td></tr>';
  $$('#tbl-rodada tbody tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id, chk = $('[data-sel]', tr), qt = $('[data-qtde]', tr);
    chk.addEventListener('change', () => { chk.checked ? selecao.set(id, +qt.value || 1) : selecao.delete(id); resumoRodada(); });
    qt.addEventListener('input', () => { if (chk.checked) selecao.set(id, +qt.value || 1); else { chk.checked = true; selecao.set(id, +qt.value || 1); } resumoRodada(); });
  });
  resumoRodada();
}
function resumoRodada() {
  const ids = [...selecao.keys()];
  const sem = ids.filter((id) => !ultimoDoc(id, 'pedido') || !ultimoDoc(id, 'relatorio')).length;
  const sess = [...selecao.values()].reduce((a, b) => a + b, 0);
  $('#rodada-resumo').innerHTML = ids.length ? `${ids.length} pacientes · ${sess} sessões${sem ? ` · <b style="color:var(--bad)">${sem} sem pedido ou relatório</b>` : ''}` : 'Nenhum paciente marcado.';
  $('#btn-criar-rodada').disabled = !ids.length;
}
$('#busca-rodada').addEventListener('input', renderRodada);
$('#chk-todos').addEventListener('change', (e) => {
  $$('#tbl-rodada tbody tr[data-id]').forEach((tr) => {
    $('[data-sel]', tr).checked = e.target.checked;
    e.target.checked ? selecao.set(tr.dataset.id, +$('[data-qtde]', tr).value || 1) : selecao.delete(tr.dataset.id);
  });
  resumoRodada();
});
$('#btn-criar-rodada').addEventListener('click', async () => {
  const [codigo, desc] = $('#rodada-proc').value.split('|');
  const sem = [...selecao.keys()].filter((id) => !ultimoDoc(id, 'pedido') || !ultimoDoc(id, 'relatorio'));
  if (sem.length && !confirm(`${sem.length} paciente(s) estão sem pedido ou relatório. Eles entram na rodada como "não enviada". Continuar?`)) return;
  const { data: rod, error } = await comSessao(() => sb.from('sps_rodadas').insert({ data: $('#rodada-data').value || hoje(), procedimento_codigo: codigo, procedimento_descricao: desc }).select().single());
  if (error) return toast(error.message, true);
  const itens = [...selecao.entries()].map(([pid, qtde]) => {
    const ped = ultimoDoc(pid, 'pedido'), rel = ultimoDoc(pid, 'relatorio');
    return { rodada_id: rod.id, paciente_id: pid, qtde, procedimento_codigo: codigo, pedido_id: ped?.id || null, relatorio_id: rel?.id || null,
      status: ped && rel ? 'pendente' : 'nao_enviada', observacoes: ped && rel ? null : 'Falta ' + [!ped && 'pedido', !rel && 'relatório'].filter(Boolean).join(' e ') };
  });
  const ins = await comSessao(() => sb.from('sps_rodada_itens').insert(itens));
  if (ins.error) return toast(ins.error.message, true);
  await log('criou_rodada', { rodada: rod.id, pacientes: itens.length });
  selecao.clear();
  toast(`Rodada criada com ${itens.length} pacientes.`);
  await recarregar();
  $('#sel-rodada').value = rod.id;
  $('.tabs button[data-tab=painel]').click();
});

/* ---------------- PAINEL ---------------- */
const STATUS = { pendente: ['Pendente', 'b-info'], preenchida: ['Preenchida', 'b-warn'], enviada: ['Enviada', 'b-warn'], autorizada: ['Autorizada', 'b-ok'], em_analise: ['Em análise', 'b-warn'], negada: ['Negada', 'b-bad'], nao_enviada: ['Não enviada', 'b-bad'], erro: ['Erro', 'b-bad'] };
function renderSelRodada() {
  const atual = $('#sel-rodada').value;
  $('#sel-rodada').innerHTML = state.rodadas.map((r) => `<option value="${r.id}">${new Date(r.data + 'T12:00').toLocaleDateString('pt-BR')} · ${r.procedimento_codigo} · ${r.status}</option>`).join('') || '<option value="">Nenhuma rodada</option>';
  if (atual && state.rodadas.some((r) => r.id === atual)) $('#sel-rodada').value = atual;
}
$('#sel-rodada').addEventListener('change', renderPainel);
let itensAtuais = [];
let tissLigado = null;
let temFuncao = null;
async function funcaoServidorExiste() {
  if (temFuncao === null) { try { const r = await fetch('/api/tiss'); temFuncao = r.ok && (r.headers.get('content-type') || '').includes('json'); } catch { temFuncao = false; } }
  return temFuncao;
}
async function statusTiss() { if (tissLigado === null) { try { tissLigado = !!(await (await fetch('/api/tiss')).json()).configurado; } catch { tissLigado = false; } } return tissLigado; }
async function renderPainel() {
  const rid = $('#sel-rodada').value;
  if (!rid) { $('#tbl-itens tbody').innerHTML = '<tr><td colspan="10" class="muted">Crie uma rodada na aba Rodada do dia.</td></tr>'; $('#rodada-info').innerHTML = ''; return; }
  const { data, error } = await sb.from('sps_rodada_itens').select('*, paciente:sps_pacientes(*)').eq('rodada_id', rid);
  if (error) return toast(error.message, true);
  itensAtuais = (data || []).sort((a, b) => a.paciente.nome.localeCompare(b.paciente.nome));
  const ligado = await statusTiss();
  const cont = (s) => itensAtuais.filter((i) => i.status === s).length;
  const ia = itensAtuais.filter((i) => i.feito_por === 'Claude (IA)').length;
  $('#rodada-info').innerHTML = `<div class="kpi"><b>${itensAtuais.length}</b><span class="muted">pacientes</span></div>
    <div class="kpi"><b>${cont('pendente')}</b><span class="muted">pendentes</span></div>
    <div class="kpi"><b>${cont('autorizada')}</b><span class="muted">autorizadas</span></div>
    <div class="kpi"><b>${cont('nao_enviada') + cont('erro') + cont('negada')}</b><span class="muted">com problema</span></div>
    <div class="kpi"><b>${ia}</b><span class="muted">feitas pelo Claude</span></div>`;
  $('#cmd-claude').textContent = `Rode a rodada ${rid} da plataforma SP/SADT (Supabase ypcunysgtzdgqamkygtz, site ${location.origin})`;
  const doc = (id) => { const d = state.docs.find((x) => x.id === id); return d ? `<a href="#" onclick="abrirDoc('${d.id}');return false">${d.tipo === 'pedido' ? 'Pedido' : 'Relatório'}</a>` : ''; };
  $('#tbl-itens tbody').innerHTML = itensAtuais.map((i) => {
    const [rot, cls] = STATUS[i.status] || [i.status, 'b-info'];
    return `<tr data-id="${i.id}">
      <td><b>${esc(i.paciente.nome)}</b><br><span class="muted">${esc(i.paciente.carteirinha)}</span>${i.observacoes ? `<br><span class="muted">${esc(i.observacoes)}</span>` : ''}</td>
      <td>${esc(i.procedimento_codigo)}</td><td>${i.qtde}</td>
      <td>${[doc(i.pedido_id), doc(i.relatorio_id)].filter(Boolean).join(' · ') || '<span class="badge b-bad">sem anexos</span>'}</td>
      <td><select data-status>${Object.entries(STATUS).map(([k, [r]]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${r}</option>`).join('')}</select> <span class="badge ${cls}">${rot}</span></td>
      <td contenteditable data-c="numero_guia">${esc(i.numero_guia)}</td>
      <td contenteditable data-c="senha">${esc(i.senha)}</td>
      <td>${i.feito_por ? `<span class="badge ${i.feito_por === 'Claude (IA)' ? 'ia' : 'b-info'}">${esc(i.feito_por)}</span>` : ''}</td>
      <td class="muted">${esc(i.aprovado_por || '')}</td>
      <td><button class="btn small" data-xml>XML</button> <button class="btn small primary" data-enviar ${i.status === 'pendente' ? '' : 'disabled'}>${ligado ? 'Enviar' : 'Enviar pelo Claude'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="10" class="muted">Rodada vazia.</td></tr>';

  $$('#tbl-itens tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const marcarHumano = { feito_por: 'Humano', aprovado_por: state.user.email };
    $('[data-status]', tr).addEventListener('change', async (e) => {
      const { error } = await sb.from('sps_rodada_itens').update({ status: e.target.value, ...marcarHumano }).eq('id', id);
      if (error) toast(error.message, true); else { await log('alterou_status', { item: id, status: e.target.value }); renderPainel(); }
    });
    $$('[contenteditable]', tr).forEach((td) => td.addEventListener('blur', async () => {
      const { error } = await sb.from('sps_rodada_itens').update({ [td.dataset.c]: td.textContent.trim() || null, ...marcarHumano }).eq('id', id);
      if (error) toast(error.message, true);
    }));
    $('[data-xml]', tr).addEventListener('click', () => chamarTiss(id, true));
    $('[data-enviar]', tr).addEventListener('click', async () => {
      const it = itensAtuais.find((x) => x.id === id);
      if (!ligado) {
        const cmd = $('#cmd-claude').textContent;
        try { await navigator.clipboard.writeText(cmd); toast('Comando copiado. Cole na conversa com o Claude para ele preencher no portal.'); }
        catch { prompt('Copie e cole na conversa com o Claude:', cmd); }
        return;
      }
      if (confirm(`Enviar a solicitação de ${it.paciente.nome} (${it.qtde} sessão(ões)) para a SulAmérica pelo webservice?`)) chamarTiss(id, false);
    });
  });
}
async function xmlNoNavegador(itemId) {
  const { xmlSolicitacao } = await import('./tiss-xml.js');
  const { data: item, error } = await comSessao(() => sb.from('sps_rodada_itens').select('*, pac:sps_pacientes(*), rod:sps_rodadas(*)').eq('id', itemId).single());
  if (error) return toast(error.message, true);
  const xml = xmlSolicitacao({ item, pac: item.pac, rod: item.rod, cfg: state.config || {} });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([xml], { type: 'application/xml' })), download: `solicitacao-sp-sadt-${itemId.slice(0, 8)}.xml` });
  a.click(); URL.revokeObjectURL(a.href);
}
async function chamarTiss(itemId, somenteXml) {
  if (!(await garantirSessao())) return;
  if (somenteXml && !(await funcaoServidorExiste())) return xmlNoNavegador(itemId);
  const s = { session: sessao };
  const r = await fetch('/api/tiss', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.session.access_token }, body: JSON.stringify({ itemId, somenteXml }) });
  if (somenteXml && r.ok) {
    const blob = await r.blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `solicitacao-sp-sadt-${itemId.slice(0, 8)}.xml` });
    a.click(); URL.revokeObjectURL(a.href); return;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return toast(j.erro || `Falha (${r.status})`, true);
  toast(j.mensagem || 'Enviado.');
  renderPainel();
}
$('#btn-csv').addEventListener('click', () => {
  const cab = ['Paciente', 'Carteirinha', 'Procedimento', 'Qtde', 'Status', 'Nº guia', 'Senha', 'Feito por', 'Aprovado por', 'Observações'];
  const linhas = itensAtuais.map((i) => [i.paciente.nome, i.paciente.carteirinha, i.procedimento_codigo, i.qtde, STATUS[i.status]?.[0] || i.status, i.numero_guia, i.senha, i.feito_por, i.aprovado_por, i.observacoes]);
  const csv = [cab, ...linhas].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: `rodada-${$('#sel-rodada').value.slice(0, 8)}.csv` });
  a.click();
});

/* ---------------- CONFIG ---------------- */
async function renderConfig() {
  const f = $('#form-config');
  if (state.config) for (const [k, v] of Object.entries(state.config)) if (f.elements[k]) f.elements[k].value = v ?? '';
  const m = await sb.from('sps_membros').select('email,nome,papel').order('email');
  $('#lista-membros').innerHTML = (m.data || []).map((x) => `<li>${esc(x.nome || '')} &lt;${esc(x.email)}&gt; · ${esc(x.papel)}</li>`).join('');
  try {
    if (!(await funcaoServidorExiste())) { $('#tiss-status').innerHTML = '<span class="badge b-warn">Envio automático indisponível nesta hospedagem</span> o botão XML gera o arquivo no navegador.'; return; }
    const r = await fetch('/api/tiss', { method: 'GET' });
    const j = await r.json();
    $('#tiss-status').innerHTML = j.configurado ? '<span class="badge b-ok">Configurado</span> o botão Enviar usa o webservice.' : '<span class="badge b-warn">Aguardando dados da SulAmérica</span> por enquanto o botão XML gera o arquivo da solicitação para conferência/homologação.';
  } catch { $('#tiss-status').textContent = 'Função de envio indisponível.'; }
}
$('#form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  const { error } = await sb.from('sps_config').update(dados).eq('id', 1);
  $('#config-msg').className = 'msg ' + (error ? 'err' : 'ok');
  $('#config-msg').textContent = error ? error.message : 'Salvo.';
  if (!error) log('alterou_config', dados);
});

// Atalho usado pelo Claude (skill) para baixar anexos com link temporário, usando a sessão de quem está logado
window.sps = {
  async linkTemporario(storagePath, segundos = 600) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, segundos);
    if (error) throw error;
    return data.signedUrl;
  },
};

iniciar();
