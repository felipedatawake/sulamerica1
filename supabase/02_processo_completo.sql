-- Aplicado no projeto como migrations sps_05_processo_completo e sps_06_status_parcial_cancelada (24/10/2026)
create table if not exists public.sps_profissionais (
  id uuid primary key default gen_random_uuid(), aba text not null unique, nome text,
  conselho text not null default '09', numero_conselho text, uf text not null default 'SP',
  cbo text not null default '251510', cpf text, updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'));
alter table public.sps_profissionais enable row level security;
create policy sps_profissionais_membros on public.sps_profissionais for all using (public.sps_is_member()) with check (public.sps_is_member());
alter table public.sps_pacientes add column if not exists nome_social text;
alter table public.sps_documentos add column if not exists data_documento date;
alter table public.sps_rodada_itens add column if not exists qtde_autorizada int, add column if not exists data_autorizacao date,
  add column if not exists senha_validade date, add column if not exists conferencia jsonb,
  add column if not exists conferido_em timestamptz, add column if not exists proxima_verificacao date;
create table if not exists public.sps_sessoes (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references public.sps_rodada_itens(id) on delete cascade,
  data date not null, hora_inicio time, hora_fim time, assinada boolean not null default false, observacao text,
  created_at timestamptz not null default now(), created_by text default (auth.jwt() ->> 'email'), unique (item_id, data, hora_inicio));
alter table public.sps_sessoes enable row level security;
create policy sps_sessoes_membros on public.sps_sessoes for all using (public.sps_is_member()) with check (public.sps_is_member());
alter table public.sps_config add column if not exists tipo_atendimento text default '03', add column if not exists regime_atendimento text default '01',
  add column if not exists indicacao_acidente text default '9', add column if not exists validade_pedido_dias int default 90,
  add column if not exists validade_senha_dias int default 30, add column if not exists dias_reverificar int default 2,
  add column if not exists exigir_relatorio boolean default true;
alter table public.sps_rodada_itens drop constraint sps_rodada_itens_status_check;
alter table public.sps_rodada_itens add constraint sps_rodada_itens_status_check check (status = any (array['pendente','preenchida','enviada','autorizada','parcial','em_analise','negada','nao_enviada','erro','cancelada']));
alter table public.sps_rodada_itens add constraint sps_rodada_itens_qtde_aut_check check (qtde_autorizada is null or qtde_autorizada between 0 and 99);
