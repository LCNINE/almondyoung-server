// scripts/ops/1016-7-8-predeploy-check.js
// READ ONLY. #1016 7·8번 배포 전 확인 (스펙 §11).
//   ① core·channel_adapter 의 outbox FAILED 목록 — sequencedTopics 를 켜는 순간 그 토픽(주문 생애)의 옛 FAILED 가
//      같은 주문의 새 이벤트를 막기 시작한다(목록에 [순서] 표시). 배포 직후 화면에서 다시 보내거나 종결한다
//   ② 새 선택 조건의 EXPLAIN ANALYZE — 수백 ms 를 넘으면 (topic, aggregate_id, created_at) 부분 인덱스를 먼저 더한다
//   ③ 상태별 건수
//   ④ PROCESSING 인데 retry_count >= 8 인 행 — 0 이어야 한다(수동 다시 보내기의 lease 규칙이 이 행을 전제하지 않는다)
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/1016-7-8-predeploy-check.js)"
const postgres = require('postgres');
const d = JSON.parse(process.env.SST_RESOURCE_Db);
const connect = (database) =>
  postgres({
    host: process.env.DB_TUNNEL_HOST || d.host,
    port: Number(process.env.DB_TUNNEL_PORT || d.port),
    username: d.username,
    password: d.password,
    database,
    ssl: 'require',
    max: 1,
  });

// 앱별 outbox `sequencedTopics` — apps/core/src/modules/catalog/catalog.module.ts · apps/channel-adapter/src/adapter.module.ts
// 의 스트림 상수와 같아야 한다(이 스크립트는 sst shell 의 node -e 로 돌아 TS 상수를 import 할 수 없다).
const SEQUENCED_TOPICS = {
  core: [
    'core.orders.events.v1',
    'channel-orders.commands.v1',
    'fulfillments.events.v1',
    'fulfillments.events.v2',
    'shipments.events.v1',
  ],
  channel_adapter: ['orders.events.v1'],
};

// 디스패처 acquireEventBatch 의 조건과 같아야 한다(outbox-dispatcher.service.ts aggregateSequenceCondition)
const acquireWithSequence = (topics) => `
  explain analyze
  select id from event.outbox_events o
  where o.status = 'PENDING' and o.retry_count < 8 and o.next_attempt_at <= now()
    and (
      o.topic not in (${topics.map((t) => `'${t}'`).join(', ')})
      or not exists (
        select 1 from event.outbox_events previous
        where previous.topic = o.topic and previous.aggregate_id = o.aggregate_id
          and previous.status in ('PENDING', 'PROCESSING', 'FAILED')
          and (previous.created_at < o.created_at or (previous.created_at = o.created_at and previous.id < o.id))
      )
    )
  order by o.created_at limit 100`;

(async () => {
  for (const database of ['core', 'channel_adapter']) {
    const sql = connect(database);
    try {
      console.log(`\n== ${database}`);
      const byStatus = await sql`select status, count(*)::int as n from event.outbox_events group by 1 order by 1`;
      console.log('③ 상태별:', byStatus.map((r) => `${r.status}=${r.n}`).join(' '));
      const [stuck] = await sql`
        select count(*)::int as n from event.outbox_events
        where status = 'PROCESSING' and retry_count >= 8`;
      console.log(`④ PROCESSING 이면서 retry_count >= 8: ${stuck.n}건 (0 이어야 한다)`);
      const failed = await sql`
        select id, topic, event_type, aggregate_id, retry_count,
               created_at at time zone 'Asia/Seoul' as created_kst, left(coalesce(error_message, ''), 160) as error
        from event.outbox_events where status = 'FAILED' order by created_at`;
      console.log(`① FAILED ${failed.length}건`);
      for (const row of failed) {
        const mark = SEQUENCED_TOPICS[database].includes(row.topic) ? '[순서]' : '      ';
        console.log('  ', mark, JSON.stringify(row));
      }
      const plan = await sql.unsafe(acquireWithSequence(SEQUENCED_TOPICS[database]));
      console.log('② 계획:');
      for (const row of plan) console.log('  ', row['QUERY PLAN']);
    } finally {
      await sql.end();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
