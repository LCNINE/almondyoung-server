import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const mk = (d: string) => postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: d, ssl: 'require', max: 1, connect_timeout: 25 });
const ca = mk('channel_adapter'), mem = mk('membership'), med = mk('medusa');
(async () => {
  const U = '70c4cb47-f424-436e-9ef3-c32ba0f8e46a';
  console.log('=== 1) 윤해인 MembershipStatusChanged inbox 이벤트 ===');
  const ev = await ca`SELECT event_type, status, attempts, error_message, created_at FROM inbox_events
    WHERE event_type ILIKE '%embership%' AND payload::text ILIKE ${'%'+U+'%'} ORDER BY created_at DESC`;
  if (!ev.length) console.log('  ❌ 이벤트 아예 없음 → 멤버십서비스가 이벤트를 발행 안 했거나 channel-adapter가 안 받음');
  for (const r of ev as any[]) console.log('  ', JSON.stringify(r));

  console.log('\n=== 2) MembershipStatusChanged 전체 최근 상태 분포 (최근 30일) ===');
  const dist = await ca`SELECT status, count(*)::int n FROM inbox_events
    WHERE event_type='MembershipStatusChanged' AND created_at > CURRENT_DATE - 30 GROUP BY status ORDER BY n DESC`;
  for (const r of dist as any[]) console.log('  ', JSON.stringify(r));
  if (!dist.length) console.log('  (최근 30일 MembershipStatusChanged 이벤트 0건 — 발행 자체가 안 되는 중일 수 있음)');

  console.log('\n=== 3) 실패(failed) 샘플 5건 ===');
  const failed = await ca`SELECT payload->>'userId' uid, payload->>'email' email, payload->>'status' st, attempts, error_message, created_at
    FROM inbox_events WHERE event_type='MembershipStatusChanged' AND status='failed' ORDER BY created_at DESC LIMIT 5`;
  for (const r of failed as any[]) console.log('  ', JSON.stringify(r));
  if (!failed.length) console.log('  (failed 없음)');

  console.log('\n=== 4) 광범위 드리프트: SSOT 활성인데 medusa 그룹 OUT 인 인원 ===');
  const active = await mem`SELECT DISTINCT user_id FROM subscription_entitlement WHERE is_current=true AND ends_at>=CURRENT_DATE`;
  const ids = (active as any[]).map((r) => r.user_id);
  console.log('  SSOT 활성 인원:', ids.length);
  // medusa: 그 userId 들 중 그룹에 든 수
  const inGroup = await med`SELECT count(DISTINCT c.metadata->>'almond_user_id')::int n
    FROM customer c JOIN customer_group_customer cgc ON cgc.customer_id=c.id AND cgc.deleted_at IS NULL
    WHERE cgc.customer_group_id='cusgroup_01KFZ12A1M344F6HKGDV35J28A' AND c.metadata->>'almond_user_id' = ANY(${ids})`;
  const nIn = (inGroup as any[])[0].n;
  console.log('  그 중 medusa 그룹 IN:', nIn, '/ OUT(미반영):', ids.length - nIn);
  await ca.end({ timeout: 5 }); await mem.end({ timeout: 5 }); await med.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
