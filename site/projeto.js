// Qual Supabase (projeto da clínica) este navegador usa.
// Cada clínica tem o próprio projeto Supabase; o site é o mesmo para todas.
// Ordem: link com ?url=...&chave=... (salva neste navegador) → escolha salva → projeto padrão (AGAPAN).
const PADRAO = { url: 'https://ypcunysgtzdgqamkygtz.supabase.co', chave: 'sb_publishable_Zl11bOWU5l3V7Nky3TNf-g_HBeFoNU8', nome: 'AGAPAN' };
const CHAVE_LS = 'sps-projeto';

export const refDoUrl = (url) => (String(url).match(/https:\/\/([a-z0-9]{20})\.supabase\.co/) || [])[1] || '';

export function normalizaUrl(v) {
  const s = String(v || '').trim();
  if (/^[a-z0-9]{20}$/.test(s)) return `https://${s}.supabase.co`;
  const ref = refDoUrl(s) || (s.match(/project\/([a-z0-9]{20})/) || [])[1];
  return ref ? `https://${ref}.supabase.co` : '';
}

function lerSalvo() {
  try { return JSON.parse(localStorage.getItem(CHAVE_LS) || 'null'); } catch { return null; }
}
export function salvarProjeto(p) {
  try { localStorage.setItem(CHAVE_LS, JSON.stringify(p)); } catch {}
}
export function esquecerProjeto() {
  try { localStorage.removeItem(CHAVE_LS); } catch {}
}

export function projetoAtual() {
  const qs = new URLSearchParams(location.search);
  const url = normalizaUrl(qs.get('url') || qs.get('projeto') || '');
  const chave = (qs.get('chave') || '').trim();
  if (url && /^sb_publishable_|^eyJ/.test(chave)) {
    const p = { url, chave, nome: (qs.get('clinica') || '').trim() || null };
    salvarProjeto(p);
    // tira os dados do projeto da barra de endereço depois de salvar
    ['url', 'projeto', 'chave', 'clinica'].forEach((k) => qs.delete(k));
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
    return { ...p, origem: 'link' };
  }
  const salvo = lerSalvo();
  if (salvo?.url && salvo?.chave) return { ...salvo, origem: 'salvo' };
  return { ...PADRAO, origem: 'padrao' };
}

// Confere se a URL/chave respondem e se o banco da plataforma já foi instalado nesse projeto
export async function testarProjeto(url, chave) {
  try {
    const r = await fetch(`${url}/rest/v1/rpc/sps_is_member`, { method: 'POST', headers: { apikey: chave, 'content-type': 'application/json' }, body: '{}' });
    if (r.status === 401 && /key|apikey|jwt/i.test(await r.clone().text())) return { ok: false, motivo: 'chave' };
    const t = await r.text();
    if (r.ok) return { ok: true, instalado: true };
    if (/Could not find the function|PGRST202|does not exist/i.test(t)) return { ok: true, instalado: false };
    if (/permission denied|42501/i.test(t)) return { ok: true, instalado: true };
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: 'chave' };
    return { ok: true, instalado: true };
  } catch {
    return { ok: false, motivo: 'url' };
  }
}

export const linkDaEquipe = (p) => {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  const qs = new URLSearchParams({ url: p.url, chave: p.chave });
  if (p.nome) qs.set('clinica', p.nome);
  return `${base}?${qs}`;
};
