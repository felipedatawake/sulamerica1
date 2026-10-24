// Conferência de cada guia SP/SADT antes do envio, conforme o padrão TISS e as regras do portal SulAmérica.
// erros = impedem o envio; alertas = enviar só depois de conferir.

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const LIMITE = 10485760;
const SUGESTAO_CID = { TDAH: 'F90.0', TEA: 'F84.0', AUTISMO: 'F84.0', ANSIEDADE: 'F41.1', DEPRESSAO: 'F32.9', TOD: 'F91.3' };

export const somenteDigitos = (s) => String(s ?? '').replace(/\D/g, '');
const dias = (a, b) => Math.round((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 864e5);

// "F.68" -> "F68", "f 41.1" -> "F41.1"; devolve null se não parece CID-10
export function normalizaCid(c) {
  const s = String(c ?? '').toUpperCase().replace(/^CID\s*(10)?\s*[-:;]?\s*/, '').replace(/\s+/g, '').replace(/^([A-Z])\.(\d)/, '$1$2');
  const m = s.match(/^([A-Z]\d{2})(?:\.?(\d{1,2}))?$/);
  return m ? m[1] + (m[2] ? '.' + m[2] : '') : null;
}
export function sugereCid(c) {
  const k = String(c ?? '').toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '');
  return SUGESTAO_CID[k] || null;
}

/**
 * @param {object} p
 *  pac: paciente; prof: profissional executante (pela aba) ou null
 *  pedido, relatorio: documentos (ou null); cfg: sps_config
 *  outros: itens de outras rodadas do mesmo paciente (status, senha_validade, qtde_autorizada, sessoes_realizadas, numero_guia)
 *  qtde: sessões pedidas; hoje: 'AAAA-MM-DD'
 */
export function conferir({ pac, prof, pedido, relatorio, cfg = {}, outros = [], qtde = 1, hoje }) {
  const erros = [], alertas = [];
  const cart = somenteDigitos(pac.carteirinha);
  if (cart.length !== 20) erros.push(`Carteirinha com ${cart.length} dígitos (a SulAmérica usa 20)`);
  if (!String(pac.medico ?? '').trim()) erros.push('Falta o nome do médico solicitante');
  const crm = somenteDigitos(pac.crm);
  if (!crm) erros.push('Falta o número do CRM do médico solicitante');
  else if (crm.length > 15) erros.push('CRM inválido');
  if (!UFS.includes(String(pac.crm_uf || '').toUpperCase())) erros.push('UF do CRM inválida');
  const cbo = somenteDigitos(pac.cbo);
  if (cbo.length !== 6) erros.push('CBO do solicitante precisa ter 6 dígitos');
  else if (!/^225/.test(cbo)) alertas.push(`CBO ${cbo} não é de médico (esperado 225xxx)`);
  const cid = normalizaCid(pac.cid);
  if (!cid) {
    const sug = sugereCid(pac.cid);
    erros.push(pac.cid ? `CID "${pac.cid}" fora do formato CID-10${sug ? ` (sugestão: ${sug})` : ''}` : 'Falta o CID');
  }
  if (!(qtde >= 1)) erros.push('Sessões = 0: informe de 1 a 99 para enviar');
  else if (qtde > 99) erros.push('Sessões acima de 99');

  const anexo = (d, nome, obrig) => {
    if (!d) { (obrig ? erros : alertas).push(`Falta o ${nome}`); return; }
    if (!['application/pdf', 'image/jpeg'].includes(d.mime)) erros.push(`${nome} em formato não aceito (só PDF ou JPG)`);
    if (d.tamanho > LIMITE) erros.push(`${nome} acima de 10 MB`);
  };
  anexo(pedido, 'pedido médico', true);
  anexo(relatorio, 'relatório', cfg.exigir_relatorio !== false);

  if (pedido && hoje) {
    const lim = cfg.validade_pedido_dias || 90;
    if (pedido.data_documento) {
      const idade = dias(hoje, pedido.data_documento);
      if (idade > lim) alertas.push(`Pedido médico emitido há ${idade} dias (limite configurado: ${lim})`);
      if (idade < 0) erros.push('Data do pedido médico está no futuro');
    } else alertas.push('Data de emissão do pedido não informada (confira se ainda está válido)');
  }

  for (const o of outros) {
    const saldo = (o.qtde_autorizada ?? 0) - (o.sessoes_realizadas ?? 0);
    if (o.status === 'em_analise') alertas.push(`Já existe solicitação em análise${o.numero_guia ? ` (guia ${o.numero_guia})` : ''}`);
    if (o.status === 'autorizada' && (!o.senha_validade || o.senha_validade >= hoje) && saldo > 0)
      alertas.push(`Já tem guia autorizada com ${saldo} sessão(ões) de saldo${o.senha_validade ? ` até ${o.senha_validade.split('-').reverse().join('/')}` : ''}`);
  }
  if (!prof?.numero_conselho) alertas.push('Psicólogo executante sem CRP cadastrado (necessário na execução/faturamento)');
  return { erros, alertas, ok: !erros.length, cidNormalizado: cid };
}

// Situação de uma guia depois de autorizada (acompanhamento / validação posterior)
export function situacaoPosterior(item, hoje, cfg = {}) {
  const avisos = [];
  const feitas = item.sessoes_realizadas ?? 0, aut = item.qtde_autorizada;
  if (item.status === 'em_analise') {
    const desde = (item.executado_em || item.updated_at || '').slice(0, 10);
    const d = desde ? dias(hoje, desde) : 0;
    avisos.push({ nivel: d >= (cfg.dias_reverificar || 2) ? 'bad' : 'warn', txt: `Em análise há ${d} dia(s): reconsultar no portal` });
  }
  if (item.status === 'autorizada') {
    if (aut == null) avisos.push({ nivel: 'warn', txt: 'Informe a quantidade autorizada' });
    if (!item.senha) avisos.push({ nivel: 'warn', txt: 'Senha não registrada' });
    if (item.senha_validade) {
      const r = dias(item.senha_validade, hoje);
      if (r < 0) avisos.push({ nivel: 'bad', txt: `Senha vencida há ${-r} dia(s)` + (aut != null && feitas < aut ? ` · ${aut - feitas} sessão(ões) não usadas` : '') });
      else if (r <= 7) avisos.push({ nivel: 'warn', txt: `Senha vence em ${r} dia(s)` });
    } else avisos.push({ nivel: 'warn', txt: 'Validade da senha não registrada' });
    if (aut != null && feitas >= aut) avisos.push({ nivel: 'info', txt: 'Sessões esgotadas: pedir nova guia se o tratamento continua' });
    if (aut != null && feitas > aut) avisos.push({ nivel: 'bad', txt: `${feitas - aut} sessão(ões) acima do autorizado` });
  }
  if (item.status === 'negada') avisos.push({ nivel: 'bad', txt: 'Negada: ver motivo e decidir recurso/nova solicitação' });
  return avisos;
}
