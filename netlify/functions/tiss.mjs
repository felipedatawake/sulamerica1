// Envio da solicitação SP/SADT pelo webservice TISS da operadora.
// GET  /api/tiss            -> { configurado: bool }
// POST /api/tiss {itemId, somenteXml}
//   somenteXml=true  -> devolve o XML TISS da solicitação (para conferência/homologação)
//   somenteXml=false -> envia ao webservice (TISS_URL) e grava guia/senha/status no item
// Segredos (variáveis do Netlify, nunca no navegador): TISS_URL, TISS_LOGIN, TISS_SENHA,
// TISS_SOAP_ACTION (opcional), TISS_WS_ROOT (opcional, padrão solicitacaoProcedimentoWS).
import { createHash } from 'node:crypto';

const SUPABASE_URL = 'https://ypcunysgtzdgqamkygtz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Zl11bOWU5l3V7Nky3TNf-g_HBeFoNU8';
const NS = 'http://www.ans.gov.br/padroes/tiss/schemas';

const env = (k) => Netlify.env.get(k);
const configurado = () => !!(env('TISS_URL') && env('TISS_LOGIN') && env('TISS_SENHA'));
const json = (obj, status = 200) => Response.json(obj, { status });

async function rest(path, token, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.message || `Supabase ${r.status}`);
  return body;
}

// ---- XML TISS ----
const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function el(nome, filhos) {
  if (filhos == null || filhos === '') return '';
  if (Array.isArray(filhos)) { const c = filhos.join(''); return c ? `<ans:${nome}>${c}</ans:${nome}>` : ''; }
  return `<ans:${nome}>${x(filhos)}</ans:${nome}>`;
}
// Hash TISS: MD5 da concatenação dos conteúdos de todos os elementos (sem tags), em ISO-8859-1
function hashTiss(xmlSemEpilogo) {
  const texto = xmlSemEpilogo.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return createHash('md5').update(Buffer.from(texto, 'latin1')).digest('hex');
}
const UF_IBGE = { AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53', ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15', PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43', RO: '11', RR: '14', TO: '17', SC: '42', SP: '35', SE: '28' };

function montarXml({ item, pac, rod, cfg, comLogin }) {
  const agora = new Date(Date.now() - 3 * 3600e3); // horário de Brasília
  const data = agora.toISOString().slice(0, 10), hora = agora.toISOString().slice(11, 19);
  const carater = /urg/i.test(cfg.carater || '') ? '2' : '1';
  const cid = (pac.cid || '').split('/')[0].trim();
  const numeroGuiaPrestador = pac.carteirinha; // padrão da clínica: carteirinha como nº da guia no prestador

  const cabecalho = [
    el('identificacaoTransacao', [
      el('tipoTransacao', 'SOLICITACAO_PROCEDIMENTOS'),
      el('sequencialTransacao', String(Date.now()).slice(-12)),
      el('dataRegistroTransacao', data),
      el('horaRegistroTransacao', hora),
    ]),
    el('origem', [el('identificacaoPrestador', [el('codigoPrestadorNaOperadora', cfg.codigo_prestador)])]),
    el('destino', [el('registroANS', cfg.registro_ans || '006246')]),
    el('Padrao', cfg.versao_tiss || '4.00.00'),
    comLogin ? el('loginSenhaPrestador', [el('loginPrestador', env('TISS_LOGIN')), el('senhaPrestador', env('TISS_SENHA'))]) : '',
  ];
  const sadt = el('solicitacaoSP-SADT', [
    el('cabecalhoSolicitacao', [el('registroANS', cfg.registro_ans || '006246'), el('numeroGuiaPrestador', numeroGuiaPrestador)]),
    el('dadosBeneficiario', [el('numeroCarteira', pac.carteirinha), el('atendimentoRN', 'N')]),
    el('dadosSolicitante', [
      el('contratadoSolicitante', [el('codigoPrestadorNaOperadora', cfg.codigo_prestador)]),
      el('nomeContratadoSolicitante', cfg.nome_contratado),
      el('profissionalSolicitante', [
        el('nomeProfissional', pac.medico),
        el('conselhoProfissional', '06'), // CRM
        el('numeroConselhoProfissional', pac.crm),
        el('UF', UF_IBGE[(pac.crm_uf || 'SP').toUpperCase()] || '35'),
        el('CBOS', pac.cbo),
      ]),
    ]),
    el('caraterAtendimento', carater),
    el('dataSolicitacao', rod.data || data),
    el('indicacaoClinica', cid ? `CID 10 ${cid}` : ''),
    el('procedimentosSolicitados', [
      el('procedimento', [el('codigoTabela', '22'), el('codigoProcedimento', item.procedimento_codigo || rod.procedimento_codigo), el('descricaoProcedimento', rod.procedimento_descricao)]),
      el('quantidadeSolicitada', String(item.qtde)),
    ]),
    el('dadosExecutante', [el('codigonaOperadora', cfg.codigo_prestador), el('CNES', cfg.cnes)]),
  ]);
  const corpo = el('cabecalho', cabecalho) + el('prestadorParaOperadora', [el('solicitacaoProcedimento', [sadt])]);
  const hash = hashTiss(corpo);
  return { corpo, hash, numeroGuiaPrestador };
}

function mensagemTiss(corpo, hash) {
  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n<ans:mensagemTISS xmlns:ans="${NS}">${corpo}<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo></ans:mensagemTISS>`;
}
function envelopeSoap(corpo, hash) {
  const raiz = env('TISS_WS_ROOT') || 'solicitacaoProcedimentoWS';
  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ans="${NS}"><soapenv:Header/><soapenv:Body><ans:${raiz}>${corpo}<ans:hash>${hash}</ans:hash></ans:${raiz}></soapenv:Body></soapenv:Envelope>`;
}

const tag = (xml, nome) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([^<]*)</(?:\\w+:)?${nome}>`, 'i')); return m ? m[1].trim() : null; };
const STATUS_TISS = { 1: 'autorizada', 2: 'em_analise', 3: 'negada', 4: 'em_analise', 5: 'em_analise', 6: 'em_analise', 7: 'negada' };

export default async (req) => {
  if (req.method === 'GET') return json({ configurado: configurado() });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ erro: 'Faça login.' }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ erro: 'Requisição inválida.' }, 400); }
  const { itemId, somenteXml } = body || {};
  if (!/^[0-9a-f-]{36}$/i.test(itemId || '')) return json({ erro: 'Item inválido.' }, 400);

  try {
    // RLS do Supabase garante que só membros autorizados leem estes dados
    const [item] = await rest(`sps_rodada_itens?id=eq.${itemId}&select=*,pac:sps_pacientes(*),rod:sps_rodadas(*)`, token);
    if (!item) return json({ erro: 'Item não encontrado ou sem permissão.' }, 404);
    const [cfg] = await rest('sps_config?id=eq.1&select=*', token);
    const { pac, rod } = item;
    const faltando = ['carteirinha', 'medico', 'crm', 'cbo'].filter((k) => !pac[k]);
    if (!cfg?.codigo_prestador) faltando.push('código do prestador (Configurações)');
    if (faltando.length) return json({ erro: `Dados faltando: ${faltando.join(', ')}.` }, 422);

    if (somenteXml) {
      const { corpo, hash } = montarXml({ item, pac, rod, cfg, comLogin: false });
      return new Response(mensagemTiss(corpo, hash), { headers: { 'content-type': 'application/xml; charset=ISO-8859-1', 'content-disposition': `attachment; filename="solicitacao-${itemId.slice(0, 8)}.xml"` } });
    }

    if (!configurado()) return json({ erro: 'Webservice TISS ainda não configurado. Use o botão XML para gerar a solicitação, ou rode a rodada pelo Claude.' }, 503);
    if (item.status !== 'pendente') return json({ erro: `Este item está "${item.status}" e não pode ser reenviado.` }, 409);
    if (!item.pedido_id || !item.relatorio_id) return json({ erro: 'Faltam pedido ou relatório.' }, 422);

    const email = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).email;
    const { corpo, hash, numeroGuiaPrestador } = montarXml({ item, pac, rod, cfg, comLogin: true });
    await rest(`sps_rodada_itens?id=eq.${itemId}`, token, { method: 'PATCH', body: JSON.stringify({ status: 'enviada', feito_por: 'Humano', aprovado_por: email, executado_em: new Date().toISOString(), requisicao: { numeroGuiaPrestador, hash, via: 'webservice TISS' } }) });

    const resp = await fetch(env('TISS_URL'), {
      method: 'POST',
      headers: { 'content-type': 'text/xml; charset=ISO-8859-1', SOAPAction: env('TISS_SOAP_ACTION') || '' },
      body: Buffer.from(envelopeSoap(corpo, hash), 'latin1'),
      signal: AbortSignal.timeout(45000),
    });
    const texto = Buffer.from(await resp.arrayBuffer()).toString('latin1');
    const guia = tag(texto, 'numeroGuiaOperadora');
    const senha = tag(texto, 'senha');
    const st = tag(texto, 'statusSolicitacao');
    const erroMsg = tag(texto, 'descricaoGlosa') || tag(texto, 'mensagemErro') || tag(texto, 'descricaoErro') || tag(texto, 'faultstring');
    const status = !resp.ok || (!guia && erroMsg) ? 'erro' : STATUS_TISS[st] || 'em_analise';

    await rest(`sps_rodada_itens?id=eq.${itemId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status, numero_guia: guia, senha, status_operadora: st, observacoes: erroMsg ? `Operadora: ${erroMsg}` : 'Enviado pelo webservice TISS', resposta: { http: resp.status, corpo: texto.slice(0, 20000) } }),
    });
    await rest('sps_log', token, { method: 'POST', body: JSON.stringify({ acao: 'enviou_tiss', autor_tipo: 'Humano', detalhes: { item: itemId, status, guia } }) });

    // Anexos: a mensagem de solicitação TISS não carrega arquivos; o envio do pedido e do relatório
    // segue o canal de anexos definido pela SulAmérica na homologação.
    return json({ ok: status !== 'erro', status, numero_guia: guia, senha, mensagem: status === 'erro' ? `Operadora recusou: ${erroMsg || 'HTTP ' + resp.status}` : `Enviado. Status: ${status}${guia ? ' · guia ' + guia : ''}` }, status === 'erro' ? 502 : 200);
  } catch (e) {
    return json({ erro: e.name === 'TimeoutError' ? 'A operadora não respondeu a tempo.' : e.message }, 500);
  }
};

export const config = { path: '/api/tiss' };
