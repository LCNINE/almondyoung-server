const { Client } = require('pg');
// 로컬 리허설은 MEDUSA_DATABASE_URL 로 준다(없으면 sst shell 의 SST_RESOURCE_Db — 라이브 경로 그대로).
const ids = (process.env.DISPLAY_IDS || '').split(',').map(Number).filter(Boolean);
const medusaUrl = () => { if (process.env.MEDUSA_DATABASE_URL) return process.env.MEDUSA_DATABASE_URL; const d = JSON.parse(process.env.SST_RESOURCE_Db); return `postgresql://${d.username}:${d.password}@${process.env.DB_TUNNEL_HOST || d.host}:${process.env.DB_TUNNEL_PORT || d.port}/medusa?sslmode=disable`; };
const c = new Client({ connectionString: medusaUrl() });
(async () => { await c.connect(); const r = await c.query(`update order_item oi set shipped_quantity=oi.quantity,updated_at=now() where oi.deleted_at is null and oi.shipped_quantity<oi.quantity and exists(select 1 from "order" o join order_line_item oli on oli.id=oi.item_id and oli.deleted_at is null where o.id=oi.order_id and o.display_id=any($1::int[]) and oli.requires_shipping=true)`, [ids]); console.log(JSON.stringify({ ids, updatedRows: r.rowCount })); await c.end(); })().catch((e) => { console.error(e); process.exit(1); });
