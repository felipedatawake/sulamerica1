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
