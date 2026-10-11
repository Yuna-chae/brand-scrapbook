// 공개되어도 되는 값입니다 (Supabase anon key는 브라우저용 공개 키).
// 실제 권한은 DB의 RLS(팀원 명단)로 막혀 있습니다.
export const SUPABASE_URL = 'https://iriomhlzkdtyomwkqkpn.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyaW9taGx6a2R0eW9td2txa3BuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNzQ2MjQsImV4cCI6MjEwNjk1MDYyNH0.TDVy8XJxOP_KS8dUaMk08zndanJnLbuvtSAfTcwJ45k';
export const PHOTO_BUCKET = 'visit-photos';
export const MAX_PHOTOS = 20;
// 푸시 알림용 공개 키 (비공개 키는 Vercel 환경 변수에만 있습니다)
export const VAPID_PUBLIC_KEY = 'BEMe72Y9m9hZVRmw7k4vHf_eIPWakgbcPpL5qBmRvjW3ukM7bMFLwOhPnXrsqWLR-Ms9JFJyMJFad1X2q2bQEBs';
