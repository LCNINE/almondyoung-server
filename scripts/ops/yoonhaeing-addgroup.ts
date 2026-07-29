import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const med = postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: 'medusa', ssl: 'require', max: 1, connect_timeout: 20 });
(async () => {
  const C = 'cus_01KYBZBK9PQ8XMMJR0G6YD1VYZ';
  const GROUP = 'cusgroup_01KFZ12A1M344F6HKGDV35J28A';
  const ins = await med`
    INSERT INTO customer_group_customer (id, customer_id, customer_group_id)
    VALUES ('cusgc_manual_' || replace(gen_random_uuid()::text,'-',''), ${C}, ${GROUP})
    ON CONFLICT DO NOTHING RETURNING id`;
  console.log(ins.length ? '그룹 추가됨: ' + (ins as any[])[0].id : '이미 있음(conflict)');
  const g = await med`SELECT cg.name FROM customer_group_customer cgc JOIN customer_group cg ON cg.id=cgc.customer_group_id WHERE cgc.customer_id=${C} AND cgc.customer_group_id=${GROUP} AND cgc.deleted_at IS NULL`;
  console.log('검증 — Membership 그룹:', g.length ? 'IN ✅' : 'OUT ❌');
  await med.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
