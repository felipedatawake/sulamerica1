-- Plataforma SP/SADT — instalação do banco numa clínica nova (versão 2026-10-28)
-- Como usar: Supabase > seu projeto > SQL Editor > New query > colar tudo > Run.
-- Pode rodar de novo sem problema (não apaga dados).

create table if not exists public.sps_membros (
  email text primary key,
  nome text,
  papel text not null default 'operador' check (papel in ('admin','operador')),
  created_at timestamptz not null default now()
);

create or replace function public.sps_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sps_membros m where lower(m.email) = lower(coalesce(auth.jwt()->>'email','')));
$$;
revoke all on function public.sps_is_member() from public;
grant execute on function public.sps_is_member() to authenticated;

create table if not exists public.sps_pacientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_norm text not null unique,
  carteirinha text not null,
  medico text,
  crm text,
  crm_uf text not null default 'SP',
  cbo text,
  cid text,
  aba_origem text,
  ativo boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt()->>'email')
);

create table if not exists public.sps_documentos (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid references public.sps_pacientes(id) on delete set null,
  tipo text not null check (tipo in ('pedido','relatorio','outro')),
  arquivo_nome text not null,
  storage_path text not null unique,
  tamanho bigint,
  mime text,
  created_at timestamptz not null default now(),
  created_by text default (auth.jwt()->>'email')
);
create index if not exists sps_documentos_paciente_idx on public.sps_documentos(paciente_id, tipo, created_at desc);

create table if not exists public.sps_rodadas (
  id uuid primary key default gen_random_uuid(),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  procedimento_codigo text not null default '50000470',
  procedimento_descricao text not null default 'SESSAO DE PSICOTERAPIA INDIVIDUAL POR PSICOLOGO',
  status text not null default 'aberta' check (status in ('aberta','em_execucao','concluida','cancelada')),
  observacao text,
  created_at timestamptz not null default now(),
  created_by text default (auth.jwt()->>'email')
);

create table if not exists public.sps_rodada_itens (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null references public.sps_rodadas(id) on delete cascade,
  paciente_id uuid not null references public.sps_pacientes(id),
  qtde int not null default 1 check (qtde between 1 and 99),
  procedimento_codigo text,
  pedido_id uuid references public.sps_documentos(id),
  relatorio_id uuid references public.sps_documentos(id),
  status text not null default 'pendente' check (status in ('pendente','preenchida','enviada','autorizada','em_analise','negada','nao_enviada','erro')),
  numero_guia text,
  senha text,
  status_operadora text,
  feito_por text,
  aprovado_por text,
  observacoes text,
  executado_em timestamptz,
  requisicao jsonb,
  resposta jsonb,
  updated_at timestamptz not null default now(),
  unique (rodada_id, paciente_id)
);

create table if not exists public.sps_config (
  id int primary key default 1 check (id = 1),
  codigo_prestador text,
  cnes text,
  nome_contratado text,
  registro_ans text default '006246',
  versao_tiss text default '4.00.00',
  procedimento_padrao text default '50000470',
  carater text default 'Eletivo',
  tecnica text default 'Convencional',
  updated_at timestamptz not null default now()
);

create table if not exists public.sps_log (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  quem text default coalesce(auth.jwt()->>'email','sistema'),
  autor_tipo text not null default 'Humano' check (autor_tipo in ('Humano','Claude (IA)','Sistema')),
  acao text not null,
  detalhes jsonb
);

create or replace function public.sps_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists sps_pacientes_touch on public.sps_pacientes;
create trigger sps_pacientes_touch before update on public.sps_pacientes for each row execute function public.sps_touch();
drop trigger if exists sps_itens_touch on public.sps_rodada_itens;
create trigger sps_itens_touch before update on public.sps_rodada_itens for each row execute function public.sps_touch();

-- Acesso: só e-mails cadastrados em sps_membros
do $$ declare t text; begin
  foreach t in array array['sps_pacientes','sps_documentos','sps_rodadas','sps_rodada_itens','sps_config','sps_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_membros', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.sps_is_member()) with check (public.sps_is_member())', t||'_membros', t);
  end loop;
end $$;
alter table public.sps_membros enable row level security;
drop policy if exists sps_membros_ler on public.sps_membros;
create policy sps_membros_ler on public.sps_membros for select to authenticated using (public.sps_is_member());

-- Pasta privada para os PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sps-documentos','sps-documentos', false, 10485760, array['application/pdf','image/jpeg','image/jpg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sps_docs_membros on storage.objects;
create policy sps_docs_membros on storage.objects for all to authenticated
  using (bucket_id = 'sps-documentos' and public.sps_is_member())
  with check (bucket_id = 'sps-documentos' and public.sps_is_member());

-- E-mails autorizados não precisam confirmar o cadastro
create or replace function public.sps_autoconfirma() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if exists (select 1 from public.sps_membros m where lower(m.email) = lower(new.email)) then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end $$;
drop trigger if exists sps_autoconfirma on auth.users;
create trigger sps_autoconfirma before insert on auth.users for each row execute function public.sps_autoconfirma();


-- ===== Processo completo (profissionais, sessões, autorização, conferência) =====
create table if not exists public.sps_profissionais (
  id uuid primary key default gen_random_uuid(), aba text not null unique, nome text,
  conselho text not null default '09', numero_conselho text, uf text not null default 'SP',
  cbo text not null default '251510', cpf text, updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'));
alter table public.sps_profissionais enable row level security;
drop policy if exists sps_profissionais_membros on public.sps_profissionais;
create policy sps_profissionais_membros on public.sps_profissionais for all to authenticated using (public.sps_is_member()) with check (public.sps_is_member());

alter table public.sps_pacientes add column if not exists nome_social text;
alter table public.sps_documentos add column if not exists data_documento date;
alter table public.sps_rodada_itens
  add column if not exists qtde_autorizada int, add column if not exists data_autorizacao date,
  add column if not exists senha_validade date, add column if not exists conferencia jsonb,
  add column if not exists conferido_em timestamptz, add column if not exists proxima_verificacao date,
  add column if not exists impressa_em timestamptz;
alter table public.sps_rodada_itens drop constraint if exists sps_rodada_itens_status_check;
alter table public.sps_rodada_itens add constraint sps_rodada_itens_status_check check (status = any (array['pendente','preenchida','enviada','autorizada','parcial','em_analise','negada','nao_enviada','erro','cancelada']));
alter table public.sps_rodada_itens drop constraint if exists sps_rodada_itens_qtde_aut_check;
alter table public.sps_rodada_itens add constraint sps_rodada_itens_qtde_aut_check check (qtde_autorizada is null or qtde_autorizada between 0 and 99);

create table if not exists public.sps_sessoes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.sps_rodada_itens(id) on delete cascade,
  data date not null, assinada boolean not null default false, observacao text,
  created_at timestamptz not null default now(), created_by text default (auth.jwt() ->> 'email'),
  constraint sps_sessoes_item_data_key unique (item_id, data));
alter table public.sps_sessoes enable row level security;
drop policy if exists sps_sessoes_membros on public.sps_sessoes;
create policy sps_sessoes_membros on public.sps_sessoes for all to authenticated using (public.sps_is_member()) with check (public.sps_is_member());

alter table public.sps_config
  add column if not exists tipo_atendimento text default '03', add column if not exists regime_atendimento text default '01',
  add column if not exists indicacao_acidente text default '9', add column if not exists validade_pedido_dias int default 90,
  add column if not exists validade_senha_dias int default 30, add column if not exists dias_reverificar int default 2,
  add column if not exists exigir_relatorio boolean default true, add column if not exists imprimir_guia boolean default true;


-- ===== Administradores gerenciam a equipe pelo site =====
create or replace function public.sps_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sps_membros m where lower(m.email) = lower(coalesce(auth.jwt()->>'email','')) and m.papel = 'admin');
$$;
revoke all on function public.sps_is_admin() from public;
grant execute on function public.sps_is_admin() to authenticated;
drop policy if exists sps_membros_admin_insere on public.sps_membros;
create policy sps_membros_admin_insere on public.sps_membros for insert to authenticated with check (public.sps_is_admin());
drop policy if exists sps_membros_admin_altera on public.sps_membros;
create policy sps_membros_admin_altera on public.sps_membros for update to authenticated using (public.sps_is_admin()) with check (public.sps_is_admin());
drop policy if exists sps_membros_admin_remove on public.sps_membros;
create policy sps_membros_admin_remove on public.sps_membros for delete to authenticated
  using (public.sps_is_admin() and lower(email) <> lower(coalesce(auth.jwt()->>'email','')));

-- ===== Dados da clínica (preenchidos pelo site antes de copiar) =====
insert into public.sps_membros (email, nome, papel) values (lower('{{EMAIL_ADMIN}}'), '{{NOME_ADMIN}}', 'admin') on conflict (email) do update set papel = 'admin';
insert into public.sps_config (id, codigo_prestador, cnes, nome_contratado) values (1, '{{CODIGO_PRESTADOR}}', '{{CNES}}', '{{NOME_CLINICA}}')
  on conflict (id) do update set codigo_prestador = excluded.codigo_prestador, cnes = excluded.cnes, nome_contratado = excluded.nome_contratado;
