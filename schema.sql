-- =====================================================================
-- 브랜드 스크랩북 · Supabase 초기 설정
-- Supabase 대시보드 > SQL Editor > New query 에 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 작성했습니다.
-- =====================================================================

-- 1. 팀원 명단 -----------------------------------------------------------
-- 이 표에 있는 지메일만 앱 내용을 보고 쓸 수 있습니다.
create table if not exists public.members (
  email        text primary key,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_member() to anon, authenticated;

-- 2. 사용자 프로필 (구글 이름·사진) -------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  name       text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 팀원 명단에 있는 사람만, 표시 이름이 있으면 구글 이름 대신 그 이름으로 보여줍니다.
create or replace view public.people
with (security_invoker = true) as
select p.id,
       coalesce(m.display_name, p.name) as name,
       p.avatar_url
from public.profiles p
join public.members m on lower(m.email) = lower(p.email);

-- 3. 태그 ---------------------------------------------------------------
-- kind: industry(업종) / type(성격)
create table if not exists public.tags (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('industry', 'type')),
  name       text not null check (char_length(name) between 1 and 20),
  sort       int  not null default 100,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (kind, name)
);

insert into public.tags (kind, name, sort) values
  ('industry', '금융권', 1), ('industry', '경쟁사', 2), ('industry', '유통', 3),
  ('industry', '패션', 4),  ('industry', '뷰티', 5),   ('industry', 'F&B', 6),
  ('type', '브랜딩', 1), ('type', '마케팅', 2), ('type', '오프라인', 3),
  ('type', '굿즈', 4),   ('type', '콘텐츠', 5)
on conflict (kind, name) do nothing;

-- 4. 레퍼런스 -----------------------------------------------------------
create table if not exists public.refs (
  id         bigint generated always as identity primary key,
  url        text not null,
  title      text,
  summary    text,
  image_url  text,
  site_name  text,
  industry   text[] not null default '{}',
  types      text[] not null default '{}',
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 링크 없이 사진·내용만 올리는 레퍼런스 (2026-10-08 추가)
alter table public.refs alter column url drop not null;
alter table public.refs add column if not exists photos text[] not null default '{}';
alter table public.refs drop constraint if exists refs_photo_limit;
alter table public.refs add constraint refs_photo_limit check (cardinality(photos) <= 10);
create index if not exists refs_created_idx  on public.refs (created_at desc);
create index if not exists refs_industry_idx on public.refs using gin (industry);
create index if not exists refs_types_idx    on public.refs using gin (types);

-- 5. 답사기록 ----------------------------------------------------------
-- blocks: 본문을 글/사진 블록 순서대로 저장
--   [{"t":"text","v":"..."}, {"t":"img","path":"<uid>/<file>.jpg"}]
create table if not exists public.visits (
  id         bigint generated always as identity primary key,
  category   text not null check (category in ('경쟁사', '삼성금융', '기타')),
  title      text not null check (char_length(title) between 1 and 120),
  place      text,
  visited_on date,
  blocks     jsonb not null default '[]',
  cover_path text,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visits_max_20_photos check (
    jsonb_array_length(coalesce(jsonb_path_query_array(blocks, '$[*] ? (@.t == "img")'), '[]')) <= 20
  )
);
create index if not exists visits_created_idx on public.visits (created_at desc);

create table if not exists public.visit_comments (
  id         bigint generated always as identity primary key,
  visit_id   bigint not null references public.visits (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists visit_comments_visit_idx on public.visit_comments (visit_id, created_at);

create table if not exists public.visit_likes (
  visit_id   bigint not null references public.visits (id) on delete cascade,
  user_id    uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (visit_id, user_id)
);

-- 피드용 집계 뷰 (좋아요·댓글 수)
create or replace view public.visit_feed
with (security_invoker = true) as
select v.id, v.category, v.title, v.place, v.visited_on, v.cover_path,
       v.author_id, v.created_at,
       (select count(*) from public.visit_likes l where l.visit_id = v.id)    as like_count,
       (select count(*) from public.visit_comments c where c.visit_id = v.id) as comment_count
from public.visits v;

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists refs_touch on public.refs;
create trigger refs_touch before update on public.refs
  for each row execute function public.touch_updated_at();
drop trigger if exists visits_touch on public.visits;
create trigger visits_touch before update on public.visits
  for each row execute function public.touch_updated_at();

-- 6. 권한 (RLS) --------------------------------------------------------
-- 팀원: 모두 읽기·쓰기 가능 / 수정·삭제는 본인 글만
alter table public.members        enable row level security;
alter table public.profiles       enable row level security;
alter table public.tags           enable row level security;
alter table public.refs           enable row level security;
alter table public.visits         enable row level security;
alter table public.visit_comments enable row level security;
alter table public.visit_likes    enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('members','profiles','tags','refs','visits','visit_comments','visit_likes')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy members_read   on public.members  for select to authenticated using (public.is_member());

create policy profiles_read  on public.profiles for select to authenticated using (public.is_member() or id = auth.uid());
create policy profiles_self  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_add_self on public.profiles for insert to authenticated with check (id = auth.uid());

-- 이 SQL보다 먼저 로그인해 둔 계정의 프로필도 채워 둡니다.
insert into public.profiles (id, email, name, avatar_url)
select id, email,
       coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1)),
       raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;

create policy tags_read      on public.tags for select to authenticated using (public.is_member());
create policy tags_add       on public.tags for insert to authenticated with check (public.is_member());
create policy tags_del_own   on public.tags for delete to authenticated using (created_by = auth.uid());

create policy refs_read      on public.refs for select to authenticated using (public.is_member());
create policy refs_add       on public.refs for insert to authenticated with check (public.is_member() and author_id = auth.uid());
create policy refs_edit_own  on public.refs for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy refs_del_own   on public.refs for delete to authenticated using (author_id = auth.uid());

create policy visits_read     on public.visits for select to authenticated using (public.is_member());
create policy visits_add      on public.visits for insert to authenticated with check (public.is_member() and author_id = auth.uid());
create policy visits_edit_own on public.visits for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy visits_del_own  on public.visits for delete to authenticated using (author_id = auth.uid());

create policy comments_read    on public.visit_comments for select to authenticated using (public.is_member());
create policy comments_add     on public.visit_comments for insert to authenticated with check (public.is_member() and author_id = auth.uid());
create policy comments_del_own on public.visit_comments for delete to authenticated using (author_id = auth.uid());

create policy likes_read    on public.visit_likes for select to authenticated using (public.is_member());
create policy likes_add     on public.visit_likes for insert to authenticated with check (public.is_member() and user_id = auth.uid());
create policy likes_del_own on public.visit_likes for delete to authenticated using (user_id = auth.uid());

-- 7. 사진 저장소 -------------------------------------------------------
-- 앱에서 장당 약 0.3~0.6MB로 압축해 올립니다. 파일 경로는 추측할 수 없는 무작위 이름입니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "visit photos upload" on storage.objects;
drop policy if exists "visit photos delete own" on storage.objects;
drop policy if exists "visit photos read" on storage.objects;

create policy "visit photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'visit-photos' and public.is_member());

create policy "visit photos upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'visit-photos'
    and public.is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "visit photos delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 8. 팀원 등록 ---------------------------------------------------------
-- 아래 예시를 실제 지메일로 바꿔 실행하세요. 표시 이름은 앱에 작성자로 표시됩니다.
-- insert into public.members (email, display_name, is_admin) values
--   ('example1@gmail.com', '채유나', true),
--   ('example2@gmail.com', '홍길동', false)
-- on conflict (email) do update set display_name = excluded.display_name;
