/**
 * #1016 6번 행 일회성 정리 — 옛 «수집 후 변경» 격리를 일괄 종결한다(스펙 §4, 결정 D1).
 *
 * 배경: 5번 행 이전에는 수집 뒤 채널 변경이 전부 `collected_order_modification_not_accepted` 격리가 됐다.
 * 이 사유는 replay 도 안 되므로(`not_replayable`) 영원히 열려 격리 목록·메뉴 배지를 채우고 진짜 격리(식별 실패)를 가렸다.
 * 5번 행부터 이 사유는 다시 생기지 않는다(변경은 core diff 로 간다). 5번 백필 판단(2026-10-06)이 끝나지 않은 주문 30건을
 * «반영할 실물 없음»으로 확인했다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-close-obsolete-modification-quarantines.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-close-obsolete-modification-quarantines.ts --apply  # 실제 종결
 */
import postgres from 'postgres';
import { Resource } from 'sst';

const APPLY = process.argv.includes('--apply');
const REASON =
  'Closed by scripts/ops/1016-close-obsolete-modification-quarantines.ts: post-collection changes go to Core as OrderModified since #1016 row 5';

type TargetRow = { id: string; channel: string };
type CountRow = { reason: string; n: number };

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 647 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const sql = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'channel_adapter',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });

  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    const targets = await sql<TargetRow[]>`
      SELECT id, channel
      FROM order_collection_failures
      WHERE reason = 'collected_order_modification_not_accepted' AND status = 'quarantined'
      ORDER BY created_at`;

    // 3천 건 남짓이라 행을 다 찍지 않고 채널별 수를 보인다.
    const byChannel = new Map<string, number>();
    for (const row of targets) byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + 1);
    console.log(`종결 대상: ${targets.length}건`);
    for (const [channel, n] of byChannel) console.log(`  ${channel}: ${n}건`);

    if (!APPLY) {
      console.log('\n조회만 했다. 적용하려면 --apply 를 붙일 것.');
      return;
    }
    if (targets.length === 0) {
      console.log('\n닫을 것이 없다.');
      return;
    }

    // 위에서 센 **바로 그 id 들**만 손댄다(647 과 같은 이유 — 승인한 목록과 실행 대상이 어긋나지 않게).
    const targetIds = targets.map((row) => row.id);
    const result = await sql`
      UPDATE order_collection_failures
         SET status = 'closed_obsolete',
             error_message = ${REASON},
             updated_at = now()
       WHERE id = ANY(${targetIds})
         AND status = 'quarantined'`;
    console.log(`\n종결 완료: ${result.count}건`);

    const after = await sql<CountRow[]>`
      SELECT reason, count(*)::int AS n
      FROM order_collection_failures
      WHERE status = 'quarantined'
      GROUP BY reason`;
    console.log('남은 quarantined (사유별):');
    for (const row of after) console.log(`  ${row.reason}: ${row.n}건`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
