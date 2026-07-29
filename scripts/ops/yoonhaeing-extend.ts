import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const mem = postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: 'membership', ssl: 'require', max: 1, connect_timeout: 20 });
(async () => {
  const U = '70c4cb47-f424-436e-9ef3-c32ba0f8e46a';
  const ADD_DAYS = 4;
  const before = await mem`SELECT id, starts_at, ends_at, is_current FROM subscription_entitlement WHERE user_id=${U} AND is_current=true`;
  if (before.length !== 1) { console.log('⚠️ 활성 entitlement ' + before.length + '건 — 중단'); await mem.end(); return; }
  const row = (before as any[])[0];
  console.log('BEFORE: ends_at =', row.ends_at?.toISOString?.().slice(0,10));
  const up = await mem`
    UPDATE subscription_entitlement
    SET ends_at = ends_at + (${ADD_DAYS} || ' days')::interval
    WHERE id=${row.id}
    RETURNING starts_at, ends_at`;
  const r = (up as any[])[0];
  console.log('AFTER : ends_at =', r.ends_at?.toISOString?.().slice(0,10), `(+${ADD_DAYS}일)`);
  console.log('기간:', r.starts_at?.toISOString?.().slice(0,10), '~', r.ends_at?.toISOString?.().slice(0,10));
  await mem.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
