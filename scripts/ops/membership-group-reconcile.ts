/** SSOT 활성 멤버 전원을 auth 연결 기준으로 medusa 그룹 소속 정합화.
 *  DO_WRITE=1 이면 누락자(고객 존재하나 그룹 OUT)를 그룹에 추가. */
import postgres from 'postgres';
import { Resource } from 'sst';
const db = (Resource as any).Db;
const mk = (d: string) => postgres({ host: db.host, port: db.port, username: db.username, password: db.password, database: d, ssl: 'require', max: 1, connect_timeout: 25 });
const mem = mk('membership'), med = mk('medusa');
const GROUP = 'cusgroup_01KFZ12A1M344F6HKGDV35J28A';
const DO_WRITE = process.env.DO_WRITE === '1';
(async () => {
  const active = await mem`SELECT DISTINCT user_id FROM subscription_entitlement WHERE is_current=true AND ends_at>=CURRENT_DATE`;
  const ids = (active as any[]).map((r) => r.user_id);
  console.log('SSOT 활성 회원:', ids.length);

  // auth 연결로 각 userId → 로그인 고객 + 그룹 소속 여부
  const rows = await med`
    SELECT pi.entity_id AS user_id,
           ai.app_metadata->>'customer_id' AS cid,
           EXISTS(SELECT 1 FROM customer_group_customer cgc
                  WHERE cgc.customer_id = ai.app_metadata->>'customer_id'
                    AND cgc.customer_group_id=${GROUP} AND cgc.deleted_at IS NULL) AS in_group
    FROM provider_identity pi
    JOIN auth_identity ai ON ai.id = pi.auth_identity_id
    WHERE pi.provider='user-service-sso' AND pi.entity_id = ANY(${ids})`;
  const byUser = new Map<string, any>();
  for (const r of rows as any[]) byUser.set(r.user_id, r);

  const gapNoCustomer: string[] = [];   // medusa 로그인 이력 없음(고객 없음)
  const gapOutGroup: { user: string; cid: string }[] = []; // 고객 있으나 그룹 OUT
  for (const uid of ids) {
    const r = byUser.get(uid);
    if (!r || !r.cid) { gapNoCustomer.push(uid); continue; }
    if (!r.in_group) gapOutGroup.push({ user: uid, cid: r.cid });
  }
  console.log(`\n결과: 그룹 IN 정상 ${ids.length - gapNoCustomer.length - gapOutGroup.length}명`);
  console.log(`  ⚠️ [A] 고객 있으나 그룹 OUT (즉시 수정대상): ${gapOutGroup.length}명`);
  for (const g of gapOutGroup) console.log(`      user=${g.user} cid=${g.cid}`);
  console.log(`  ℹ️ [B] medusa 고객 없음(로그인 이력 없음, 그룹부여 불가): ${gapNoCustomer.length}명`);
  for (const u of gapNoCustomer.slice(0, 20)) console.log(`      user=${u}`);
  if (gapNoCustomer.length > 20) console.log(`      ... 외 ${gapNoCustomer.length - 20}명`);

  if (DO_WRITE && gapOutGroup.length) {
    console.log('\n=== [A] 그룹 추가 실행 ===');
    for (const g of gapOutGroup) {
      const ins = await med`INSERT INTO customer_group_customer (id, customer_id, customer_group_id)
        VALUES ('cusgc_manual_' || replace(gen_random_uuid()::text,'-',''), ${g.cid}, ${GROUP})
        ON CONFLICT DO NOTHING RETURNING id`;
      console.log(ins.length ? `  ✅ ${g.cid}` : `  ↩︎ 이미존재 ${g.cid}`);
    }
  } else if (gapOutGroup.length) {
    console.log('\n[DRY-RUN] DO_WRITE=1 로 [A] 자동 추가. 지금은 조사만.');
  }
  await mem.end({ timeout: 5 }); await med.end({ timeout: 5 });
})().catch((e) => { console.error('ERR', e?.message ?? e); process.exit(1); });
