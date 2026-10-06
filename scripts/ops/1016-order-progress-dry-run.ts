/**
 * #1016 정체 보드 — 배포 전 라이브 판정 분포 확인(읽기 전용).
 *
 * 투영(order_progress)을 만들기 전에, 첫 갱신이 전 판매주문에 대해 내릴 판정을 그대로 계산해서
 * 단계별 건수·갇힘·최장 체류와 판정 SQL 소요 시간을 보인다. 아무것도 쓰지 않는다(READ ONLY 트랜잭션).
 * 특히 «1 접수(accept/no_backlog)»에 컷오버 이전 옛 주문이 얼마나 몰리는지 본다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-order-progress-dry-run.ts
 */
import postgres from 'postgres';
import { Resource } from 'sst';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { judgedRowsSql } from '../../apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql';
import {
  ORDER_PROGRESS_STAGES,
  OrderProgressStage,
  isStuck,
} from '../../apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds';

// 라이브 FULFILLMENT_V2_CUTOVER_AT (deployments/lcnine/services/infra/services.ts)
const CUTOVER = new Date('2026-07-16T00:00:00.000Z');
const DAY = 86_400_000;

type Judged = {
  sales_order_id: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: string | null;
  estimated_entered_at: string;
  ordered_at: Date;
};

async function main() {
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const pg = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'core',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });

  const now = new Date();
  const query = new PgDialect().sqlToQuery(judgedRowsSql(sql`SELECT s.id FROM sales_orders s`, now.toISOString()));

  try {
    await pg.begin('read only', async (tx) => {
      const started = Date.now();
      const rows = (await tx.unsafe(query.sql, query.params as never[])) as unknown as Judged[];
      const elapsed = Date.now() - started;
      console.log(`판매주문 ${rows.length}건 판정 — 판정 SQL ${elapsed}ms (첫 갱신의 읽기 부분과 같은 비용)\n`);

      const outcomes = new Map<string, number>();
      for (const r of rows) if (r.outcome) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
      console.log('종료:');
      for (const [k, n] of outcomes) console.log(`  ${k}: ${n}`);

      console.log('\n진행 중 (단계 · 건수 · 갇힘 · 최장 체류 · 세부 상태):');
      for (const stage of ORDER_PROGRESS_STAGES) {
        const open = rows.filter((r) => r.stage === stage);
        if (open.length === 0) continue;
        const stuck = open.filter((r) => isStuck(stage, new Date(r.estimated_entered_at), now)).length;
        const oldest = Math.min(...open.map((r) => new Date(r.estimated_entered_at).getTime()));
        const states = new Map<string, number>();
        for (const r of open) states.set(r.state ?? '', (states.get(r.state ?? '') ?? 0) + 1);
        const top = [...states].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ');
        console.log(`  ${stage}: ${open.length} · 갇힘 ${stuck} · 최장 ${Math.floor((now.getTime() - oldest) / DAY)}일 · ${top}`);
      }

      const accept = rows.filter((r) => r.stage === 'accept');
      if (accept.length > 0) {
        const statuses = (await tx.unsafe('SELECT id, status::text AS status FROM sales_orders WHERE id = ANY($1)', [
          accept.map((r) => r.sales_order_id),
        ] as never[])) as unknown as { id: string; status: string }[];
        const statusOf = new Map(statuses.map((s) => [s.id, s.status]));
        const buckets = new Map<string, { n: number; min: number; max: number }>();
        for (const r of accept) {
          const key = `${statusOf.get(r.sales_order_id)} · ${new Date(r.ordered_at) < CUTOVER ? '컷오버 이전' : '컷오버 이후'}`;
          const t = new Date(r.ordered_at).getTime();
          const b = buckets.get(key) ?? { n: 0, min: t, max: t };
          b.n += 1;
          b.min = Math.min(b.min, t);
          b.max = Math.max(b.max, t);
          buckets.set(key, b);
        }
        console.log('\n1 접수(accept) 상세 — 판매주문 상태 · 컷오버(2026-07-16) 전후 · 주문일 범위:');
        for (const [k, b] of buckets) {
          console.log(`  ${k}: ${b.n} (${new Date(b.min).toISOString().slice(0, 10)} ~ ${new Date(b.max).toISOString().slice(0, 10)})`);
        }
      }
    });
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
