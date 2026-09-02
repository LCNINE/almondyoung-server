const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const XLSX = require('xlsx');

const latest = Number(process.env.LATEST_DISPLAY_ID || 0);
const awaiting = (process.env.AWAITING_IDS || '').split(',').map(Number).filter(Boolean);
const excludedDisplayIds = new Set((process.env.EXCLUDE_DISPLAY_IDS || '').split(',').map(Number).filter(Boolean));
const includeAllAwaiting = process.env.INCLUDE_ALL_AWAITING === '1';
const prefix = process.env.OUTPUT_PREFIX || `cellmate-after-${latest}`;
const outputDir = process.env.OUTPUT_DIR || process.cwd();
const headers = ['성함', '주소', '우편번호', '연락처', '주문번호', '상품명', '옵션명', '금액', '수량', '송장번호', '상세요구사항'];

function resource(name) { return JSON.parse(process.env[`SST_RESOURCE_${name}`]); }
function dbUrl(name) { const d = resource('Db'); return `postgresql://${d.username}:${d.password}@${process.env.DB_TUNNEL_HOST || d.host}:${process.env.DB_TUNNEL_PORT || d.port}/${name}?sslmode=disable`; }
function phone(value) { const d = String(value || '').replace(/\D/g, ''); if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`; if (d.length === 10 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`; if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; return d; }
function kstDate(value) { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const m = Object.fromEntries(p.map((x) => [x.type, x.value])); return `${m.year}${m.month}${m.day}`; }
function isBasic(value) { const s = String(value || '').trim(); return !s || ['기본 옵션값', '기본 품목', '단일옵션'].includes(s) || /^P0{3,}[A-Z0-9]+$/i.test(s); }
function option(item) { if (item.option_values && !isBasic(item.option_values)) return item.option_values; if (item.variant_title && !isBasic(item.variant_title)) return item.variant_title; return '단일옵션'; }
function deliveryNote(metadata) {
  const type = metadata && metadata.shipping_memo_type;
  if (typeof type !== 'string' || !type) return '';
  const labels = { door: '문 앞에 놓아주세요', security: '경비실에 맡겨주세요', 'parcel-box': '택배함에 넣어주세요', direct: '직접 받겠습니다' };
  const note = type === 'other' ? (typeof metadata.shipping_memo_custom === 'string' ? metadata.shipping_memo_custom.trim() : '') : (labels[type] || '');
  if (type !== 'door' || metadata.has_entrance !== true) return note;
  const password = typeof metadata.entrance_password === 'string' ? metadata.entrance_password.trim() : '';
  return password ? `${note} (공동현관 ${password})` : note;
}
function csv(value) { const s = value == null ? '' : String(value); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

(async () => {
  const medusa = new Client({ connectionString: dbUrl('medusa') }); await medusa.connect();
  const wallet = new Client({ connectionString: dbUrl('wallet') }); let refundIds = new Set();
  try {
    await wallet.connect();
    refundIds = new Set((await wallet.query(`
      select intent_id::text as intent_id
      from refund_requests
      where status in ('REQUESTED','APPROVED') and intent_id is not null
      union
      select r.intent_id::text as intent_id
      from refunds r
      join payment_intents pi on pi.id = r.intent_id
      where r.status in ('PENDING','SUCCEEDED') and r.intent_id is not null
      group by r.intent_id, pi.payable_amount
      having sum(r.amount) >= pi.payable_amount
    `)).rows.map((x) => x.intent_id));
  }
  catch (e) { if (e.code !== '3D000' && !/does not exist/i.test(e.message)) throw e; }
  finally { try { await wallet.end(); } catch (_) {} }
  const orders = (await medusa.query(`select o.id,o.display_id,o.created_at,o.canceled_at,o.metadata,a.first_name as first_name,a.last_name as last_name,a.address_1,a.address_2,a.postal_code,a.phone,ps.data->>'intentId' as intent_id from "order" o left join order_address a on a.id=o.shipping_address_id left join order_payment_collection opc on opc.order_id=o.id and opc.deleted_at is null left join payment_session ps on ps.payment_collection_id=opc.payment_collection_id and ps.deleted_at is null where o.deleted_at is null and (o.display_id>$1 or o.display_id=any($2::int[]) or ($3::boolean and o.metadata->>'bank_transfer_status'='awaiting_deposit')) order by o.display_id`, [latest, awaiting, includeAllAwaiting])).rows;
  const orderIds = orders.map((x) => x.id); const itemsByOrder = new Map();
  if (orderIds.length) for (const item of (await medusa.query(`select oi.order_id,oli.title,oli.variant_title,oli.requires_shipping,oi.quantity,oi.shipped_quantity,coalesce(nullif(oli.unit_price,0),nullif(oi.unit_price,0),0) as unit_price,string_agg(pov.value,' / ' order by pov.id) as option_values from order_item oi join order_line_item oli on oli.id=oi.item_id and oli.deleted_at is null left join product_variant_option pvo on pvo.variant_id=oli.variant_id left join product_option_value pov on pov.id=pvo.option_value_id and pov.deleted_at is null where oi.deleted_at is null and oi.order_id=any($1::text[]) group by oi.order_id,oi.id,oli.id order by oi.created_at,oi.id`, [orderIds])).rows) { if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []); itemsByOrder.get(item.order_id).push(item); }
  const rows = [], included = [], excluded = [], source = [];
  for (const order of orders) {
    const shipping = { name: [order.last_name, order.first_name].filter(Boolean).join('').trim(), address: [order.address_1, order.address_2].filter(Boolean).join(' ').trim(), postal: String(order.postal_code || ''), phone: phone(order.phone), deliveryNote: deliveryNote(order.metadata) };
    const items = itemsByOrder.get(order.id) || []; const orderNo = `${kstDate(order.created_at)}-${order.display_id}`; const bank = order.metadata && order.metadata.bank_transfer_status; let reason = '';
    if (excludedDisplayIds.has(Number(order.display_id))) reason = 'manually_excluded'; else if (order.canceled_at) reason = 'canceled'; else if (bank === 'awaiting_deposit') reason = 'awaiting_deposit'; else if (order.intent_id && refundIds.has(order.intent_id)) reason = 'refund_requested_or_completed'; else if (items.some((x) => Number(x.shipped_quantity || 0) > 0)) reason = 'already_shipped'; else if (!shipping.address && !shipping.postal && !shipping.phone) reason = 'no_shipping_info_digital_or_non_delivery';
    source.push({ ...order, shipping, orderNo, items });
    if (reason) { excluded.push({ display_id: order.display_id, name: shipping.name, reason }); continue; }
    let lineCount = 0;
    for (const item of items) { if (item.requires_shipping === false || !Number(item.quantity)) continue; rows.push([shipping.name, shipping.address, shipping.postal, shipping.phone, orderNo, item.title || '', option(item), Number(item.unit_price || 0) * Number(item.quantity), Number(item.quantity), '', shipping.deliveryNote]); lineCount++; }
    if (lineCount) included.push({ display_id: order.display_id, id: order.id, name: shipping.name, phone: shipping.phone, lines: lineCount });
  }
  await medusa.end(); fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${prefix}.csv`), [headers, ...rows].map((r) => r.map(csv).join(',')).join('\n') + '\n');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]); for (let r = 1; r <= rows.length; r++) for (const c of [2, 3, 4, 8]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].t = 's'; }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'cellmate'); XLSX.writeFile(wb, path.join(outputDir, `${prefix}.xlsx`));
  fs.writeFileSync(path.join(outputDir, `${prefix}.json`), JSON.stringify({ latestDisplayId: latest, awaitingIds: awaiting, includeAllAwaiting, included, excluded, rows }, null, 2)); fs.writeFileSync(path.join(outputDir, `${prefix}-orders-source.json`), JSON.stringify(source, null, 2));
  console.log(`orders: ${included.map((x) => `#${x.display_id} ${x.name} lines=${x.lines}`).join('; ') || '(none)'}`); console.log(`rows: ${rows.length}`); console.log(`excluded: ${excluded.map((x) => `#${x.display_id} ${x.name} ${x.reason}`).join('; ') || '(none)'}`); console.log(path.join(outputDir, `${prefix}.xlsx`)); console.log(path.join(outputDir, `${prefix}.csv`));
})().catch((e) => { console.error(e); process.exit(1); });
