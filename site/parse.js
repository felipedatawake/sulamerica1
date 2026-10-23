// Leitura da planilha de pacientes e ligação de arquivos — sem dependências (testável no Node)
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'pedido', 'pedidos', 'medico', 'medica', 'relatorio', 'relatorios', 'pdf', 'jpg', 'jpeg', 'scan', 'copia', 'doc', 'encaminhamento']);

export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(\d+\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
export const tokens = (s) => norm(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));

const ehCrm = (c) => /\bcrm\b/i.test(c);
const ehCbo = (c) => /\bcbo/i.test(c);
const ehCid = (c) => /\bcid\b/i.test(c);

function limpaMedico(c) {
  return c.replace(/^\s*dr[a]?\s*[;:,./]?\s*/i, '').replace(/\s+/g, ' ').trim().toUpperCase();
}
export function extraiCid(v) {
  const s = String(v ?? '').toUpperCase().replace(/\bCID\b\s*[;:]?\s*(10\s*)?/g, ' ').replace(/([A-Z])\s+(\d)/g, '$1$2');
  const m = s.match(/[A-Z]\d{2}(\.\d)?/g);
  if (m) return [...new Set(m)].join(' / ');
  return s.replace(/[;:?]/g, ' ').replace(/\s+/g, ' ').trim();
}

// abas: [{ nome, rows: string[][] }]
export function parseAbas(abas) {
  const out = [], vistos = new Set();
  for (const { nome: aba, rows } of abas) {
    for (const row of rows || []) {
      const cells = (row || []).map((c) => String(c ?? '').trim());
      const iCart = cells.findIndex((c) => /^\d{15,22}$/.test(c.replace(/[\s.\-]/g, '')));
      if (iCart < 0) continue;
      const nome = cells.slice(0, iCart).reverse().find((c) => /[A-Za-zÀ-ú]{2,}/.test(c));
      if (!nome) continue;
      const resto = cells.slice(iCart + 1).filter(Boolean);
      const medicoCel = resto.find((c) => !ehCrm(c) && !ehCbo(c) && !ehCid(c) && /[A-Za-zÀ-ú]{3,}/.test(c));
      const crm = resto.find(ehCrm), cbo = resto.find(ehCbo), cid = resto.find(ehCid);
      const p = {
        nome: nome.replace(/\s+/g, ' ').trim().toUpperCase(),
        carteirinha: cells[iCart].replace(/\D/g, ''),
        medico: medicoCel && resto.indexOf(medicoCel) === 0 ? limpaMedico(medicoCel) : '',
        crm: crm ? (crm.match(/\d{3,}/) || [''])[0] : '',
        crm_uf: 'SP',
        cbo: cbo ? (cbo.match(/\d{6}/) || [''])[0] : '',
        cid: cid ? extraiCid(cid) : '',
        aba_origem: aba.trim(),
      };
      p.nome_norm = norm(p.nome);
      if (vistos.has(p.nome_norm)) continue;
      vistos.add(p.nome_norm);
      out.push(p);
    }
  }
  return out;
}

// Liga um nome de arquivo ao paciente mais provável
const cacheTokens = new Map();
function tokensPaciente(p) {
  let c = cacheTokens.get(p.nome);
  if (!c) { const l = tokens(p.nome); c = { l, s: new Set(l) }; cacheTokens.set(p.nome, c); }
  return c;
}
export function melhorPaciente(nomeArquivo, pacientes) {
  const ft = tokens(String(nomeArquivo).replace(/\.[a-z0-9]+$/i, ''));
  let melhor = null, score = 0, segundo = 0;
  for (const p of pacientes) {
    const { l: ptl, s: pt } = tokensPaciente(p);
    let s = 0;
    for (const t of ft) {
      if (pt.has(t)) s += t.length >= 4 ? 2 : 1;
      else if (t.length >= 4 && ptl.some((q) => q.length >= 4 && (q.startsWith(t) || t.startsWith(q)))) s += 1;
    }
    if (ft[0] && ptl[0] === ft[0]) s += 2;
    if (s > score) { segundo = score; score = s; melhor = p; } else if (s > segundo) segundo = s;
  }
  const conf = !melhor || score < 4 ? 'baixa' : score - segundo >= 3 ? 'alta' : 'média';
  return { paciente: score >= 4 ? melhor : null, conf, score };
}

export const tipoDoArquivo = (nome, padrao) => {
  const n = norm(nome);
  return /relat/.test(n) ? 'relatorio' : /pedido|encaminh|solicit/.test(n) ? 'pedido' : padrao;
};

// Tipo pelo caminho da pasta (ex.: "SULAMERICA/RELATORIOS/ALAN/x.pdf"), depois pelo nome do arquivo
export function tipoPeloCaminho(caminho, padrao) {
  const partes = String(caminho || '').split('/');
  const nome = partes.pop();
  const pastas = norm(partes.join(' '));
  if (/relat/.test(pastas)) return 'relatorio';
  if (/pedido|encaminh/.test(pastas)) return 'pedido';
  return tipoDoArquivo(nome, padrao);
}

// Usa as pastas como pista: se uma pasta tem o nome de uma aba da planilha (ex.: o profissional "ALAN"),
// procura primeiro entre os pacientes daquela aba; se não achar, procura em todos.
export function melhorPacienteComPasta(caminho, pacientes) {
  const partes = String(caminho || '').split('/');
  const nome = partes.pop();
  const pastas = new Set(partes.map(norm).filter(Boolean));
  const geral = melhorPaciente(nome, pacientes);
  const daAba = pacientes.filter((p) => pastas.has(norm(p.aba_origem)));
  if (daAba.length) {
    const r = melhorPaciente(nome, daAba);
    if (r.paciente && (!geral.paciente || r.score >= geral.score)) return { ...r, conf: r.conf === 'baixa' ? 'média' : r.conf, viaPasta: true };
  }
  return geral;
}

// Classifica o arquivo para o portal (aceita só PDF/JPG até 10 MB)
export function classificaArquivo(caminho) {
  const nome = String(caminho).split('/').pop();
  if (!nome || nome.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(nome)) return 'sistema';
  if (/\.(pdf|jpe?g)$/i.test(nome)) return 'ok';
  if (/\.(png|webp|gif|bmp|heic|heif|jfif)$/i.test(nome)) return 'converter';
  return 'nao_suportado';
}
export const ehAnexoValido = (nome) => classificaArquivo(nome) === 'ok';
