// scripts/ops/1016-36-point-refund-leg-check.js
// READ ONLY. #1016 36번 PR 0 — 포인트 환불 원장 키 결함의 라이브 실재와 영향 범위.
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/1016-36-point-refund-leg-check.js)"
const postgres = require('postgres');
const d = JSON.parse(process.env.SST_RESOURCE_Db);
const sql = postgres({
  host: process.env.DB_TUNNEL_HOST || d.host,
  port: Number(process.env.DB_TUNNEL_PORT || d.port),
  username: d.username,
  password: d.password,
  database: 'wallet',
  ssl: 'require',
  max: 1,
});

(async () => {
  await sql.begin('read only', async (tx) => {
    // 1. 포인트 결제분 환불 결과 분포 (월 × 상태 × 사유 × 결제분 종류)
    const pointRefunds = await tx`
      select to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM') as month,
             r.status, left(coalesce(r.reason_message, ''), 60) as reason_message,
             c.operation as charge_operation, count(*)::int as n, sum(r.amount)::int as amount
        from refunds r
        join charges c on c.id = r.charge_id
        join payment_methods pm on pm.id = c.payment_method_id
       where pm.type = 'POINTS'
       group by 1, 2, 3, 4
       order by 1, 2, 3`;

    // 2. REDEEM 원장 키가 가리키는 결제분 종류 (기대: 전부 AUTHORIZE)
    const redeemLegKeys = await tx`
      select c.operation, count(*)::int as redeem_events
        from point_events pe
        join charges c on c.id = pe.leg_id
       where pe.event_type = 'REDEEM'
       group by 1`;
    const redeemLegMissing = await tx`
      select count(*)::int as redeem_events_without_charge
        from point_events pe
       where pe.event_type = 'REDEEM'
         and not exists (select 1 from charges c where c.id = pe.leg_id)`;

    // 3. 확정된 포인트 결제가 있는 intent 수 (= 고치기 전엔 환불하면 실패할 대상)
    const pointIntentsWithCapture = await tx`
      select count(distinct c.intent_id)::int as point_intents_with_capture
        from charges c
        join payment_methods pm on pm.id = c.payment_method_id
       where pm.type = 'POINTS' and c.operation = 'CAPTURE' and c.status = 'SUCCEEDED'`;

    // 4. 2026-06 의 FAILED 환불 전부 (Medusa #14·#40·#321·#459 일부 환불의 원인 후보)
    const juneFailed = await tx`
      select r.intent_id, r.created_at at time zone 'Asia/Seoul' as created_kst, r.amount,
             pm.type as method_type, c.operation as charge_operation,
             r.reason_code, left(coalesce(r.reason_message, ''), 80) as reason_message
        from refunds r
        join charges c on c.id = r.charge_id
        join payment_methods pm on pm.id = c.payment_method_id
       where r.status = 'FAILED'
         and r.created_at >= '2026-06-01' and r.created_at < '2026-07-01'
       order by r.created_at`;

    // 5. FAILED 환불의 수단 × 사유 분포
    const failedByMethod = await tx`
      select pm.type as method_type, left(coalesce(r.reason_message, ''), 60) as reason_message,
             count(*)::int as n
        from refunds r
        join charges c on c.id = r.charge_id
        join payment_methods pm on pm.id = c.payment_method_id
       where r.status = 'FAILED'
       group by 1, 2
       order by 3 desc
       limit 30`;

    // 6. 확정된 포인트 결제분 중 승인 결제분 id 를 모르는 행 (고친 뒤에도 환불 못 하는 결제)
    const capturesWithoutAuthorizeId = await tx`
      select count(*) filter (where c.request_payload ? 'authorizeChargeId')::int as with_authorize_id,
             count(*) filter (where not coalesce(c.request_payload ? 'authorizeChargeId', false))::int as without_authorize_id
        from charges c
        join payment_methods pm on pm.id = c.payment_method_id
       where pm.type = 'POINTS' and c.operation = 'CAPTURE' and c.status = 'SUCCEEDED'`;

    console.log(
      JSON.stringify(
        { pointRefunds, redeemLegKeys, redeemLegMissing, pointIntentsWithCapture, juneFailed, failedByMethod, capturesWithoutAuthorizeId },
        null,
        2,
      ),
    );
  });
  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
