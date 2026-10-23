# SP/SADT Sulamerica — AGAPAN

Plataforma para preparar e acompanhar as solicitações SP/SADT (VPP) da SulAmérica Saúde.

- `site/` — site estático (login, importação de planilha/pedidos/relatórios, rodada do dia, painel). Publicado pelo GitHub Pages a cada push em `main` e também no Netlify (`apagan.netlify.app`).
- `supabase/` — esquema do banco (tabelas `sps_*`, RLS por membro) e funções.
- `netlify/functions/tiss.mjs` — envio pelo webservice TISS (só no Netlify; credenciais em variáveis secretas).
- `apps-script/` — script do Google Drive que monta a pasta "SULAMERICA - COMPLETOS".

Nenhuma senha ou chave secreta fica neste repositório. A chave publicável do Supabase em `site/app.js` é pública por natureza; o acesso aos dados é protegido por login + RLS.
