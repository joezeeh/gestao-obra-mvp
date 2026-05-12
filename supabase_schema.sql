-- Schema inicial do MVP de Gestao de Obra.
-- Cole este arquivo no Supabase em SQL Editor > New query > Run.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  builder_name text not null default '',
  location text not null default '',
  logo_url text,
  photo_url text,
  updated_at timestamptz,
  target_delivery_date date,
  created_at timestamptz not null default now()
);

alter table public.projects
add column if not exists target_delivery_date date;

create table if not exists public.floors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  unit_count integer not null default 1 check (unit_count > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  tracking_level text not null default 'unit' check (tracking_level in ('unit', 'floor')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  floor_id uuid not null references public.floors(id) on delete cascade,
  unit_label text not null,
  done boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (stage_id, floor_id, unit_label)
);

create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  measured_at date not null,
  forecast_finish_date date,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.measurement_stage_totals (
  id uuid primary key default gen_random_uuid(),
  measurement_id uuid not null references public.measurements(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  completed_count integer not null default 0,
  total_count integer not null default 0,
  unique (measurement_id, stage_id)
);

create index if not exists floors_project_sort_idx on public.floors(project_id, sort_order);
create index if not exists stages_project_sort_idx on public.stages(project_id, sort_order);
create index if not exists progress_project_idx on public.progress(project_id);
create index if not exists measurements_project_sort_idx on public.measurements(project_id, sort_order);
create index if not exists measurement_totals_project_idx on public.measurement_stage_totals(project_id);

alter table public.projects enable row level security;
alter table public.floors enable row level security;
alter table public.stages enable row level security;
alter table public.progress enable row level security;
alter table public.measurements enable row level security;
alter table public.measurement_stage_totals enable row level security;

-- Politicas simples para o MVP:
-- qualquer usuario logado consegue ler e editar os dados.
-- Depois podemos evoluir para permissoes por obra e por empresa.
drop policy if exists "authenticated_select_projects" on public.projects;
create policy "authenticated_select_projects"
on public.projects for select
to authenticated
using (true);

drop policy if exists "authenticated_insert_projects" on public.projects;
create policy "authenticated_insert_projects"
on public.projects for insert
to authenticated
with check (true);

drop policy if exists "authenticated_update_projects" on public.projects;
create policy "authenticated_update_projects"
on public.projects for update
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated_delete_projects" on public.projects;
create policy "authenticated_delete_projects"
on public.projects for delete
to authenticated
using (true);

drop policy if exists "authenticated_all_floors" on public.floors;
create policy "authenticated_all_floors"
on public.floors for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated_all_stages" on public.stages;
create policy "authenticated_all_stages"
on public.stages for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated_all_progress" on public.progress;
create policy "authenticated_all_progress"
on public.progress for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated_all_measurements" on public.measurements;
create policy "authenticated_all_measurements"
on public.measurements for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated_all_measurement_totals" on public.measurement_stage_totals;
create policy "authenticated_all_measurement_totals"
on public.measurement_stage_totals for all
to authenticated
using (true)
with check (true);

-- Storage para logo e foto da obra.
insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "public_read_project_assets" on storage.objects;
create policy "public_read_project_assets"
on storage.objects for select
to public
using (bucket_id = 'project-assets');

drop policy if exists "authenticated_insert_project_assets" on storage.objects;
create policy "authenticated_insert_project_assets"
on storage.objects for insert
to authenticated
with check (bucket_id = 'project-assets');

drop policy if exists "authenticated_update_project_assets" on storage.objects;
create policy "authenticated_update_project_assets"
on storage.objects for update
to authenticated
using (bucket_id = 'project-assets')
with check (bucket_id = 'project-assets');

drop policy if exists "authenticated_delete_project_assets" on storage.objects;
create policy "authenticated_delete_project_assets"
on storage.objects for delete
to authenticated
using (bucket_id = 'project-assets');

-- Ativa as tabelas na publicacao usada pelo Supabase Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'floors'
  ) then
    alter publication supabase_realtime add table public.floors;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stages'
  ) then
    alter publication supabase_realtime add table public.stages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'progress'
  ) then
    alter publication supabase_realtime add table public.progress;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'measurements'
  ) then
    alter publication supabase_realtime add table public.measurements;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'measurement_stage_totals'
  ) then
    alter publication supabase_realtime add table public.measurement_stage_totals;
  end if;
end $$;
