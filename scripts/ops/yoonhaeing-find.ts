import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const med = postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: 'medusa', ssl: 'require', max: 1, connect_timeout: 20 });
(async () => {
  const KEY = 'yoonhaeing';
  console.log('=== provider_identity (user-service-sso) login_id/email 검색 ===');
  const pid = await med`
    SELECT pi.entity_id user_id, pi.user_metadata, ai.app_metadata->>'customer_id' cid
    FROM provider_identity pi JOIN auth_identity ai ON ai.id=pi.auth_identity_id
    WHERE pi.provider='user-service-sso' AND pi.user_metadata::text ILIKE ${'%'+KEY+'%'}`;
  for (const r of pid as any[]) console.log('  ', JSON.stringify(r));
  if (!pid.length) console.log('  (provider_identity 매칭 없음)');
  console.log('\n=== customer email/name 검색 ===');
  const c = await med`SELECT id,email,first_name,metadata->>'almond_user_id' auid,created_at FROM customer WHERE email ILIKE ${'%'+KEY+'%'} OR first_name ILIKE ${'%'+KEY+'%'}`;
  for (const r of c as any[]) console.log('  ', JSON.stringify(r));
  if (!c.length) console.log('  (customer 매칭 없음)');
  await med.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
