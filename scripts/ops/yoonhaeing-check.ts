import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const mk = (d: string) => postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: d, ssl: 'require', max: 1, connect_timeout: 20 });
const mem = mk('membership'), med = mk('medusa'), wal = mk('wallet');
(async () => {
  const U = '70c4cb47-f424-436e-9ef3-c32ba0f8e46a';
  const C = 'cus_01KYBZBK9PQ8XMMJR0G6YD1VYZ';
  const GROUP = 'cusgroup_01KFZ12A1M344F6HKGDV35J28A';
  const ent = await mem`SELECT starts_at,ends_at,is_current,(is_current=true AND ends_at>=CURRENT_DATE) active,created_at FROM subscription_entitlement WHERE user_id=${U} ORDER BY created_at DESC`;
  console.log('① 멤버십 SSOT (' + ent.length + '건):');
  for (const r of ent as any[]) console.log('  ', JSON.stringify(r));
  const active = (ent as any[]).some((r) => r.active);
  console.log('  >>> 활성:', active ? 'YES ✅' : 'NO ❌');
  const g = await med`SELECT cg.id,cg.name FROM customer_group_customer cgc JOIN customer_group cg ON cg.id=cgc.customer_group_id WHERE cgc.customer_id=${C} AND cgc.deleted_at IS NULL`;
  const inG = (g as any[]).some((x) => x.id === GROUP);
  console.log('② Membership 그룹:', inG ? 'IN ✅' : 'OUT ❌', '/ 전체그룹:', JSON.stringify((g as any[]).map((x:any)=>x.name)));
  // 멤버십 결제 흔적 (참고)
  const pi = await wal`SELECT metadata->>'type' t, status, payable_amount, created_at FROM payment_intents WHERE user_id=${U} ORDER BY created_at DESC LIMIT 5`;
  console.log('③ wallet 결제:'); for (const r of pi as any[]) console.log('  ', JSON.stringify(r));
  await mem.end({ timeout: 5 }); await med.end({ timeout: 5 }); await wal.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
