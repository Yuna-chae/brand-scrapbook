-- 2026-10-08 업데이트: 링크 없이 사진·내용만으로 레퍼런스 등록
-- Supabase > SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
alter table public.refs alter column url drop not null;
alter table public.refs add column if not exists photos text[] not null default '{}';
alter table public.refs drop constraint if exists refs_photo_limit;
alter table public.refs add constraint refs_photo_limit check (cardinality(photos) <= 10);
