# 브랜드 스크랩북 · 배포 가이드

브랜드전략팀 레퍼런스 수집과 답사기록을 위한 웹앱입니다. 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `public/` | 앱 화면 (HTML·CSS·JS, 아이콘, 홈 화면 설치 설정) |
| `public/config.js` | Supabase 주소와 공개 키 (입력 완료) |
| `api/preview.js` | 링크를 읽어 대표 이미지·제목·AI 요약 2줄·추천 태그를 만드는 서버 기능 |
| `supabase/schema.sql` | DB 테이블·권한·사진 저장소 설정 |
| `vercel.json`, `package.json` | 배포 설정 |

## 1. Supabase DB 설정

1. Supabase 대시보드에서 **SQL Editor → New query**로 들어갑니다.
2. `supabase/schema.sql` 내용을 전부 붙여넣고 **Run**을 누릅니다.
3. 새 쿼리 창에 팀원 명단을 넣고 실행합니다. 표시 이름은 앱에 작성자로 나옵니다.

```sql
insert into public.members (email, display_name, is_admin) values
  ('본인@gmail.com', '채유나', true),
  ('팀원1@gmail.com', '이름', false)
on conflict (email) do update set display_name = excluded.display_name;
```

팀원이 바뀌면 같은 방식으로 추가하고, 빼려면 `delete from public.members where email = '…';`를 실행합니다.

## 2. 구글 로그인 연결

1. Google Cloud Console의 OAuth 클라이언트에서 **승인된 리디렉션 URI**에 다음 주소가 있는지 확인합니다.
   `https://iriomhlzkdtyomwkqkpn.supabase.co/auth/v1/callback`
2. Supabase **Authentication → Sign In / Providers → Google**을 켜고 클라이언트 ID와 보안 비밀번호를 입력합니다.
3. OAuth 동의 화면은 **앱 게시(프로덕션)** 상태로 바꾸는 것을 권장합니다. 이메일·프로필 기본 권한만 쓰므로 구글 심사가 필요 없고, '확인되지 않은 앱' 경고가 사라집니다. 접속은 1번의 팀원 명단으로 막혀 있습니다.

## 3. GitHub에 올리기

1. GitHub에서 만든 `brand-scrapbook` 저장소로 들어갑니다.
2. **Add file → Upload files**를 누르고, 압축을 푼 폴더 안의 내용물(`public`, `api`, `supabase`, `package.json`, `vercel.json`, `README.md`)을 끌어다 놓습니다.
3. **Commit changes**를 누릅니다.

## 4. Vercel 배포

1. Vercel에서 **Add New → Project**를 누르고 `brand-scrapbook` 저장소를 Import합니다.
2. Framework Preset은 **Other**로 두고, Build 설정은 비워둡니다.
3. **Environment Variables**에 세 가지를 넣습니다.

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://iriomhlzkdtyomwkqkpn.supabase.co` |
| `SUPABASE_ANON_KEY` | `public/config.js`에 있는 anon key |
| `GEMINI_API_KEY` | Google AI Studio에서 발급받은 키 (채팅에 붙여넣지 말고 여기에만 입력) |

4. **Deploy**를 누르면 `https://brand-scrapbook-xxxx.vercel.app` 같은 주소가 생깁니다.

## 5. 배포 주소를 Supabase에 등록

Supabase **Authentication → URL Configuration**에서 설정합니다.

- **Site URL**: Vercel 주소 (예: `https://brand-scrapbook.vercel.app`)
- **Redirect URLs**: 같은 주소 뒤에 `/**`를 붙여 추가 (예: `https://brand-scrapbook.vercel.app/**`)

이 단계를 빼면 로그인 후 엉뚱한 주소(localhost)로 돌아갑니다.

## 6. 확인 순서

1. PC 크롬에서 Vercel 주소로 들어가 구글 로그인 → 레퍼런스 링크 하나 등록 → 답사기록 사진 1장 올리기.
2. 아이폰은 **사파리**로 열어 공유 버튼 → 홈 화면에 추가 → 아이콘으로 열어 로그인.
3. 안드로이드는 크롬으로 열어 **앱 설치** → 카톡 링크를 공유 → 스크랩북으로 보내기.

## 참고

- 사진은 올릴 때 자동으로 압축됩니다 (원본 약 0.5MB + 미리보기용 약 0.1MB). Supabase 무료 용량 1GB 기준으로 약 1,500장을 저장할 수 있습니다.
- 사진 주소는 추측할 수 없는 무작위 이름이지만, 주소를 아는 사람은 로그인 없이 열 수 있습니다. 글·댓글·레퍼런스는 팀원만 볼 수 있습니다.
- 인스타그램, 일부 언론사처럼 외부 접근을 막는 사이트는 요약이 비어 나올 수 있으며, 직접 입력하면 됩니다.
- AI 요약 모델은 기본 `gemini-2.5-flash`입니다. 바꾸려면 Vercel 환경 변수에 `GEMINI_MODEL`을 추가합니다.
- 글·레퍼런스·댓글의 수정과 삭제는 작성자 본인만 할 수 있습니다.

## 업데이트 기록 (DB)

새로 설치할 때는 `supabase/schema.sql` 실행 후 `supabase/updates/` 안의 파일을 날짜 순서대로 실행합니다.

| 파일 | 내용 |
|---|---|
| `2026-10-08_refs_photos.sql` | 링크 없이 사진·내용으로 레퍼런스 등록 |
| `2026-10-11_notifications.sql` | 알림함·푸시 알림, 조용히 올리기, 답글 |

## 알림 설정 (Vercel 환경 변수)

| 이름 | 값 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API Keys > Legacy API keys의 `service_role` 키 (외부 공유 금지) |
| `VAPID_PUBLIC_KEY` | 푸시용 공개 키 (`public/config.js`의 값과 같아야 함) |
| `VAPID_PRIVATE_KEY` | 푸시용 비공개 키 (외부 공유 금지) |
| `CRON_SECRET` | 오전 9시 모아 보내기 호출 보호용 임의 문자열 |

- 업무시간(평일 9~19시)에 올라온 글·댓글은 바로 푸시, 그 외 시간은 다음 평일 오전 9시에 사람별로 묶어서 보냅니다 (`vercel.json`의 crons).
- 조용히 올린 글·댓글은 푸시 없이 알림함에만 표시됩니다.
- 아이폰은 홈 화면에 추가한 앱에서 '내 정보 > 알림'을 켜야 받을 수 있습니다.
