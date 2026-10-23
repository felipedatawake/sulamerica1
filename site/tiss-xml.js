// Geração do XML TISS da solicitação SP/SADT no navegador (usado quando a função de servidor não está disponível)
import md5 from 'https://cdn.jsdelivr.net/npm/js-md5@0.8.3/+esm';

const NS = 'http://www.ans.gov.br/padroes/tiss/schemas';
const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function el(nome, filhos) {
  if (filhos == null || filhos === '') return '';
  if (Array.isArray(filhos)) { const c = filhos.join(''); return c ? `<ans:${nome}>${c}</ans:${nome}>` : ''; }
  return `<ans:${nome}>${x(filhos)}</ans:${nome}>`;
}
function latin1Bytes(texto) {
  const out = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) { const c = texto.charCodeAt(i); out[i] = c < 256 ? c : 63; }
  return out;
}
const UF_IBGE = { AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53', ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15', PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43', RO: '11', RR: '14', TO: '17', SC: '42', SP: '35', SE: '28' };

export function xmlSolicitacao({ item, pac, rod, cfg }) {
  const agora = new Date(Date.now() - 3 * 3600e3);
  const data = agora.toISOString().slice(0, 10), hora = agora.toISOString().slice(11, 19);
  const carater = /urg/i.test(cfg.carater || '') ? '2' : '1';
  const cid = (pac.cid || '').split('/')[0].trim();
  const cabecalho = [
    el('identificacaoTransacao', [el('tipoTransacao', 'SOLICITACAO_PROCEDIMENTOS'), el('sequencialTransacao', String(Date.now()).slice(-12)), el('dataRegistroTransacao', data), el('horaRegistroTransacao', hora)]),
    el('origem', [el('identificacaoPrestador', [el('codigoPrestadorNaOperadora', cfg.codigo_prestador)])]),
    el('destino', [el('registroANS', cfg.registro_ans || '006246')]),
    el('Padrao', cfg.versao_tiss || '4.00.00'),
  ];
  const sadt = el('solicitacaoSP-SADT', [
    el('cabecalhoSolicitacao', [el('registroANS', cfg.registro_ans || '006246'), el('numeroGuiaPrestador', pac.carteirinha)]),
    el('dadosBeneficiario', [el('numeroCarteira', pac.carteirinha), el('atendimentoRN', 'N')]),
    el('dadosSolicitante', [
      el('contratadoSolicitante', [el('codigoPrestadorNaOperadora', cfg.codigo_prestador)]),
      el('nomeContratadoSolicitante', cfg.nome_contratado),
      el('profissionalSolicitante', [el('nomeProfissional', pac.medico), el('conselhoProfissional', '06'), el('numeroConselhoProfissional', pac.crm), el('UF', UF_IBGE[(pac.crm_uf || 'SP').toUpperCase()] || '35'), el('CBOS', pac.cbo)]),
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
  const texto = corpo.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const hash = md5(latin1Bytes(texto));
  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n<ans:mensagemTISS xmlns:ans="${NS}">${corpo}<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo></ans:mensagemTISS>`;
}
