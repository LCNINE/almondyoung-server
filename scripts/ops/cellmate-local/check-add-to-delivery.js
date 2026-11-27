// 이번 회차 부모에 붙은 함께 배송 주문 중, 이번 수집 파일에 없고 아직 나가지 않은 것을 찾는다.
// shipped 직전·직후에 한 번씩 돌린다. 나오면 그 display_id 를 AWAITING_IDS 로 collect-cellmate.js 를 다시 돌려
// 같은 회차에 추가 업로드한다(수집 제외 조건은 그 스크립트가 그대로 적용한다).
//
// 사용: DISPLAY_IDS=1201,1202,1205 node scripts/ops/cellmate-local/check-add-to-delivery.js
const { Client } = require('pg');

const displayIds = (process.env.DISPLAY_IDS || '').split(',').map(Number).filter(Boolean);

function resource(name) { return JSON.parse(process.env[`SST_RESOURCE_${name}`]); }
function dbUrl(name) {
  const d = resource('Db');

  return `postgresql://${d.username}:${d.password}@${process.env.DB_TUNNEL_HOST || d.host}:${process.env.DB_TUNNEL_PORT || d.port}/${name}?sslmode=disable`;
}

(async () => {
  if (displayIds.length === 0) throw new Error('DISPLAY_IDS 가 비었습니다(이번 회차 주문 display_id, 쉼표 구분)');

  const medusa = new Client({ connectionString: process.env.MEDUSA_DATABASE_URL || dbUrl('medusa') });
  await medusa.connect();

  try {
    const { rows } = await medusa.query(
      `select c.display_id as child_display_id, p.display_id as parent_display_id
         from "order" p
         join "order" c on c.metadata->>'add_to_delivery_parent_order_id' = p.id
        where p.display_id = any($1::int[])
          and c.display_id <> all($1::int[])
          and c.deleted_at is null
          and c.canceled_at is null
          and c.metadata->>'add_to_delivery_canceling_at' is null
          and coalesce(c.metadata->>'bank_transfer_status', '') <> 'awaiting_deposit'
          and not exists (
            select 1 from order_item oi
             where oi.order_id = c.id and oi.deleted_at is null and oi.shipped_quantity > 0
          )
        order by c.display_id`,
      [displayIds],
    );

    if (rows.length === 0) {
      console.log('함께 배송 추가분 0');

      return;
    }

    console.log(`함께 배송 추가분 ${rows.length}건`);
    for (const r of rows) console.log(`  ${r.child_display_id} → 부모 ${r.parent_display_id}`);
    console.log(`AWAITING_IDS=${rows.map((r) => r.child_display_id).join(',')}`);
  } finally {
    await medusa.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
