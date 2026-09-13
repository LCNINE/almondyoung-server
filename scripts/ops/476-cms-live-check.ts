/**
 * #476 닫기 판정 — wallet DB 라이브 실측 (읽기 전용).
 *
 * 2026-09-10 검증 코멘트가 요구한 세 쿼리다. 「개통 근거」로 인용된 플래그가 인보이스 스위치라
 * 출금 실적은 데이터로만 입증된다. `cms_withdrawals` 가 0행이면 개통은 플래그만 켜진 것.
 *
 * 사용법 (sst tunnel --stage live 가 떠 있어야 한다):
 *   cd deployments/lcnine/services && npx sst shell --stage live -- npx tsx ../../../scripts/ops/476-cms-live-check.ts
 */
import { createServiceConnection } from '../seeding/lib/db-connection';

async function main() {
  const sql = createServiceConnection('wallet', { max: 1 });
  try {
    const agreements = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
             max(created_at) AS last_created
        FROM billing_agreements`;
    const withdrawals = await sql`
      SELECT status, count(*)::int AS n,
             min(payment_date) AS min_payment_date, max(payment_date) AS max_payment_date,
             max(created_at) AS last_created
        FROM cms_withdrawals GROUP BY status ORDER BY 2 DESC`;
    const cmsAgreements = await sql`
      SELECT status, count(*)::int AS n FROM cms_agreements GROUP BY status ORDER BY 2 DESC`;
    console.log('## billing_agreements');
    console.table(agreements);
    console.log('## cms_withdrawals by status');
    console.table(withdrawals);
    console.log('## cms_agreements by status');
    console.table(cmsAgreements);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
