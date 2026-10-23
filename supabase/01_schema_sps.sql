-- Plataforma SP/SADT Sulamerica — tabelas com prefixo sps_
-- Rodar no SQL Editor do projeto "Teste" (Supabase > SQL Editor > New query > colar > Run)

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

-- Dados iniciais
insert into public.sps_membros (email, nome, papel) values ('felipe_monteiro2002@yahoo.com.br','Felipe','admin') on conflict do nothing;
insert into public.sps_config (id, codigo_prestador, cnes, nome_contratado) values (1,'100000019445','7269102','AGAPAN CLINICA DE PSICOLOGIA')
  on conflict (id) do update set codigo_prestador=excluded.codigo_prestador, cnes=excluded.cnes, nome_contratado=excluded.nome_contratado;
