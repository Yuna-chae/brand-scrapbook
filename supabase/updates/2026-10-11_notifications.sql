-- =====================================================================
-- 2026-10-11 업데이트: 알림(푸시·알림함), 조용히 올리기, 답글
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (여러 번 실행해도 안전)
-- =====================================================================

-- 1. 조용히 올리기 · 답글 -----------------------------------------------
alter table public.refs           add column if not exists quiet boolean not null default false;
alter table public.visits         add column if not exists quiet boolean not null default false;
alter table public.visit_comments add column if not exists quiet boolean not null default false;
alter table public.visit_comments add column if not exists parent_id bigint references public.visit_comments (id) on delete cascade;
create index if not exists visit_comments_parent_idx on public.visit_comments (parent_id);

-- 2. 알림함 -------------------------------------------------------------
-- kind: new_ref(새 레퍼런스) / new_visit(새 답사기록) / comment(내 글에 댓글) / reply(내 댓글에 답글)
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,   -- 받는 사람
  actor_id   uuid references public.profiles (id) on delete set null,           -- 한 사람
  kind       text not null check (kind in ('new_ref', 'new_visit', 'comment', 'reply')),
  ref_id     bigint references public.refs (id) on delete cascade,
  visit_id   bigint references public.visits (id) on delete cascade,
  comment_id bigint references public.visit_comments (id) on delete cascade,
  text       text,                       -- 글 제목 또는 댓글 앞부분
  quiet      boolean not null default false,
  read_at    timestamptz,
  pushed_at  timestamptz,                -- 푸시를 보냈거나 보내지 않기로 처리한 시각
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx    on public.notifications (user_id, created_at desc);
create index if not exists notifications_pending_idx on public.notifications (created_at) where pushed_at is null;

-- 3. 푸시 받을 기기 · 개인 알림 설정 ------------------------------------
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);

create table if not exists public.notify_prefs (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  new_posts  boolean not null default true,   -- 새 레퍼런스·답사기록
  reactions  boolean not null default true,   -- 내 글 댓글, 내 댓글 답글
  updated_at timestamptz not null default now()
);

-- 4. 등록되면 알림함에 자동으로 쌓기 ------------------------------------
create or replace function public.member_ids_except(p_except uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.id from public.profiles p
  join public.members m on lower(m.email) = lower(p.email)
  where p.id is distinct from p_except;
$$;

create or replace function public.notify_new_ref()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, actor_id, kind, ref_id, text, quiet)
  select uid, new.author_id, 'new_ref', new.id, left(coalesce(new.title, new.url, ''), 120), new.quiet
  from public.member_ids_except(new.author_id) as uid;
  return new;
end;
$$;

create or replace function public.notify_new_visit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, actor_id, kind, visit_id, text, quiet)
  select uid, new.author_id, 'new_visit', new.id, left(new.title, 120), new.quiet
  from public.member_ids_except(new.author_id) as uid;
  return new;
end;
$$;

create or replace function public.notify_new_comment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_owner  uuid;
  v_parent uuid;
begin
  select author_id into v_owner from public.visits where id = new.visit_id;
  if new.parent_id is not null then
    select author_id into v_parent from public.visit_comments where id = new.parent_id;
    if v_parent is not null and v_parent <> new.author_id then
      insert into public.notifications (user_id, actor_id, kind, visit_id, comment_id, text, quiet)
      values (v_parent, new.author_id, 'reply', new.visit_id, new.id, left(new.body, 120), new.quiet);
    end if;
  end if;
  -- 글쓴이에게는 댓글 알림 (답글을 받은 사람과 같으면 한 번만)
  if v_owner is not null and v_owner <> new.author_id and v_owner is distinct from v_parent then
    insert into public.notifications (user_id, actor_id, kind, visit_id, comment_id, text, quiet)
    values (v_owner, new.author_id, 'comment', new.visit_id, new.id, left(new.body, 120), new.quiet);
  end if;
  return new;
end;
$$;

drop trigger if exists refs_notify on public.refs;
create trigger refs_notify after insert on public.refs
  for each row execute function public.notify_new_ref();
drop trigger if exists visits_notify on public.visits;
create trigger visits_notify after insert on public.visits
  for each row execute function public.notify_new_visit();
drop trigger if exists comments_notify on public.visit_comments;
create trigger comments_notify after insert on public.visit_comments
  for each row execute function public.notify_new_comment();

-- 5. 권한: 각자 자기 알림·기기·설정만 ----------------------------------
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notify_prefs       enable row level security;

drop policy if exists notif_read_own   on public.notifications;
drop policy if exists notif_mark_own   on public.notifications;
drop policy if exists notif_del_own    on public.notifications;
drop policy if exists subs_read_own    on public.push_subscriptions;
drop policy if exists subs_add_own     on public.push_subscriptions;
drop policy if exists subs_edit_own    on public.push_subscriptions;
drop policy if exists subs_del_own     on public.push_subscriptions;
drop policy if exists prefs_read_own   on public.notify_prefs;
drop policy if exists prefs_add_own    on public.notify_prefs;
drop policy if exists prefs_edit_own   on public.notify_prefs;

create policy notif_read_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_mark_own on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_del_own  on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy subs_read_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy subs_add_own  on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy subs_edit_own on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy subs_del_own  on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

create policy prefs_read_own on public.notify_prefs for select to authenticated using (user_id = auth.uid());
create policy prefs_add_own  on public.notify_prefs for insert to authenticated with check (user_id = auth.uid());
create policy prefs_edit_own on public.notify_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 앱에서 직접 바꾸면 안 되는 열은 막아 둡니다 (읽음 표시만 가능)
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 내부용 함수는 앱에서 직접 부르지 못하게
revoke execute on function public.member_ids_except(uuid) from public, anon, authenticated;
