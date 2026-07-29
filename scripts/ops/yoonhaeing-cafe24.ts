import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const ca = postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: 'channel_adapter', ssl: 'require', max: 1, connect_timeout: 20 });
(async () => {
  const U = '70c4cb47-f424-436e-9ef3-c32ba0f8e46a';
  const m = await ca`SELECT cafe24_member_id, user_id, created_at FROM cafe24_member_mappings WHERE user_id=${U}`;
  console.log('윤해인 cafe24_member_mappings:', m.length ? JSON.stringify(m) : '❌ 없음 (→ 일일 크론 커버 대상 아님, 백스톱 없음)');
  const total = await ca`SELECT count(*)::int n, count(DISTINCT user_id)::int u FROM cafe24_member_mappings`;
  console.log('전체 매핑:', JSON.stringify((total as any[])[0]));
  await ca.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
