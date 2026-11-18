/**
 * 가짜 셀메이트 — 컷오버 런북(#1251, docs/runbooks/sellmate-cutover-phase1.md)을 로컬에서 끝까지 돌리기 위한 셀메이트 흉내.
 *
 * 로컬엔 셀메이트가 없어서 런북이 받는 파일(재고 현황·미발송 주문·출고 주문)과 셀메이트가 하는 일(마켓 주문·출고·반품·재고 수정 업로드)을
 * 이 스크립트가 상태 파일 하나로 흉내 낸다. 가짜 한진(scripts/local/hanjin-stub.ts)과 같은 자리다.
 *
 * 흉내의 한계 — 로컬 통과가 증명하지 않는 것:
 *   - 실제 export 양식(열 이름·순서·인코딩). 여기서는 우리 파서가 읽는 열 이름으로 셀메이트 HTML 표(EUC-KR, .xls)를 만든다.
 *   - 재고 수정 업로드의 의미. 여기서는 «바코드번호 → 현재재고 덮어쓰기»로 본다(런북 §1 의 사람 확인이 정한다).
 *   - 셀메이트가 마켓에 보내는 숫자(안정재고).
 *
 * 상태: <OUT_DIR>/fake-sellmate.json (기본 OUT_DIR = .scratch/sellmate-rehearsal). 파일도 OUT_DIR 에 쓴다.
 * DB: CORE_DATABASE_URL(기본 로컬 dev_core) · MEDUSA_DATABASE_URL(기본 로컬 medusa). init 만 읽는다. localhost 가 아니면 거절한다.
 *
 * 사용 (저장소 루트):
 *   npx tsx scripts/local/sellmate-rehearsal/fake-sellmate.ts init [--max-handed N] [--market N] [--drift N] [--force]
 *   … export                          재고 현황(stk_stockList_<KST>.xls) + 미발송 주문(sm_unshipped_<KST>.xls)
 *   … market-order [--count N]        마켓(네이버) 새 주문 — 미발송만 는다
 *   … cancel-market [--count N]       마켓 미발송 주문 취소 — 미발송이 준다
 *   … ship [--channel own|market|all] [--count N]
 *                                     셀메이트가 내보냄 — 현재재고·미발송이 같이 준다. 자사몰분은 sm_shipped_<KST>.xls 와 DISPLAY_IDS 를 찍는다
 *   … return --serial <옵션정보일련번호> [--qty N]   셀메이트 반품 입고 — 현재재고가 는다
 *   … upload <업로드 CSV>             셀메이트 «재고 수정» 업로드 — 바코드번호의 현재재고를 덮는다
 *   … status
 */
import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import postgres from 'postgres';

const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
const CORE_URL = process.env.CORE_DATABASE_URL ?? `${LOCAL_PG}/dev_core`;
const MEDUSA_URL = process.env.MEDUSA_DATABASE_URL ?? `${LOCAL_PG}/medusa`;
const OUT_DIR = process.env.OUT_DIR ?? '.scratch/sellmate-rehearsal';
const STATE_FILE = path.join(OUT_DIR, 'fake-sellmate.json');
const BUCHEON_WAREHOUSE_ID = '019d0001-0001-7000-a000-000000000001';
const KST_OFFSET_MS = 9 * 3600_000;

/** 셀메이트 판매처 이름. 런북 §4-4 의 `--own-mall-channel` 에 이 값을 준다. */
export const OWN_MALL_CHANNEL = '아몬드영(자사몰)';
export const MARKET_CHANNEL = '네이버 스마트스토어';

export type Item = {
  productCode: string;
  productSerial: string;
  productName: string;
  optionName: string;
  barcode: string;
  barcode2: string;
  current: number;
  position: string;
};
export type OrderLine = { serial: string; qty: number };
export type Order = {
  channel: string;
  orderNo: string;
  lines: OrderLine[];
  state: 'unshipped' | 'shipped' | 'canceled';
};
export type State = { items: Record<string, Item>; orders: Order[]; marketSeq: number; log: string[] };

// ── 순수 함수 (fake-sellmate.spec.ts) ─────────────────────────────────────────

export function unshippedBySerial(state: State): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of state.orders)
    if (o.state === 'unshipped') for (const l of o.lines) m.set(l.serial, (m.get(l.serial) ?? 0) + l.qty);
  return m;
}

/**
 * 셀메이트 위치 텍스트를 SKU 순번으로 고른다 — 런북 §5 의 판정 갈래가 한 번씩은 나오게.
 * exact(`A-01-03`) 가 대부분, dash-position(`O21-30-`, 켠다), zero-pad(`CC-4-1`, 꺼서 입고존에 남는다),
 * 못 읽는 텍스트(두 위치), 빈 위치.
 */
export function positionFor(i: number): string {
  if (i === 1) return 'A-01-01 / B-02-02';
  if (i % 11 === 10) return '';
  if (i % 7 === 3) return `O${20 + (i % 3)}-${10 + i}-`;
  if (i % 7 === 5) return `CC-${1 + (i % 4)}-${1 + (i % 3)}`;
  return `A-0${1 + (i % 3)}-${String(1 + (i % 20)).padStart(2, '0')}`;
}

/** 셀메이트 «재고 수정» 업로드를 반영한다: 바코드번호가 같은 품목의 현재재고를 덮는다. 못 찾은 바코드를 돌려준다. */
export function applyUpload(state: State, lines: { barcode: string; current: number }[]): string[] {
  const byBarcode = new Map(Object.entries(state.items).map(([serial, it]) => [it.barcode, serial]));
  const unknown: string[] = [];
  for (const l of lines) {
    const serial = byBarcode.get(l.barcode);
    if (!serial) unknown.push(l.barcode);
    else state.items[serial].current = l.current;
  }
  return unknown;
}

/** 셀메이트가 주문을 내보낸다: 현재재고와 미발송이 같이 준다(저녁 맞추기에선 차이 0). */
export function shipOrders(state: State, orders: Order[]): void {
  for (const o of orders) {
    for (const l of o.lines) state.items[l.serial].current -= l.qty;
    o.state = 'shipped';
  }
}

export function parseUploadCsv(text: string): { barcode: string; current: number }[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim() !== '');
  const [header, ...body] = rows;
  if (!/바코드번호\s*,\s*재고수량/.test(header ?? ''))
    throw new Error(`업로드 CSV 머리줄이 «바코드번호,재고수량» 이 아니다: ${header}`);
  return body.map((r, i) => {
    const [barcode, raw] = r.split(',');
    const current = Number(raw);
    if (!Number.isInteger(current)) throw new Error(`업로드 CSV ${i + 2}행 재고수량을 못 읽었다: ${r}`);
    return { barcode: barcode.trim(), current };
  });
}

/** 셀메이트 «엑셀» 내보내기는 EUC-KR HTML 표다(parse.ts readRows 의 마지막 갈래). */
export function renderHtmlTable(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tr = (cells: (string | number)[], tag: string) =>
    `<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
  return `<html><head><meta charset="euc-kr"></head><body><table>\n${tr(header, 'th')}\n${rows.map((r) => tr(r, 'td')).join('\n')}\n</table></body></html>\n`;
}

/** KST `YYYYMMDD_HHMMSS` — clear-reservations·evening-reconcile 가 파일명에서 스냅샷 시각을 읽는 꼴. */
export function kstStamp(at: Date): string {
  const k = new Date(at.getTime() + KST_OFFSET_MS).toISOString();
  return `${k.slice(0, 4)}${k.slice(5, 7)}${k.slice(8, 10)}_${k.slice(11, 13)}${k.slice(14, 16)}${k.slice(17, 19)}`;
}
export function kstIso(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

// ── 입출력 ───────────────────────────────────────────────────────────────────

function assertLocal(url: string): void {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url))
    throw new Error(`로컬 전용이다. localhost 가 아닌 DB: ${url.replace(/\/\/[^@]*@/, '//***@')}`);
}
function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} 이 없다 — init 부터`);
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
}
function saveState(state: State, what: string): void {
  state.log.push(`${kstIso(new Date())} ${what}`);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function writeXls(name: string, header: string[], rows: (string | number)[][]): string {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, iconv.encode(renderHtmlTable(header, rows), 'euc-kr'));
  return file;
}
function flag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));

const STOCK_HEADER = [
  '상품코드',
  '상품일련번호',
  '상품명',
  '옵션정보일련번호',
  '옵션명',
  '바코드번호',
  '바코드번호2',
  '현재재고',
  '미발송주문수',
  '상품위치',
  '대표이미지주소',
];
const ORDER_HEADER = ['판매처', '주문번호', '옵션정보일련번호', '수량'];

async function init(args: string[]): Promise<void> {
  if (fs.existsSync(STATE_FILE) && !args.includes('--force'))
    throw new Error(`${STATE_FILE} 이 이미 있다 — 처음부터면 --force`);
  assertLocal(CORE_URL);
  assertLocal(MEDUSA_URL);
  const maxHanded = num(flag(args, 'max-handed'), 5);
  const market = num(flag(args, 'market'), 3);
  const drift = num(flag(args, 'drift'), 2);
  const core = postgres(CORE_URL, { max: 1, onnotice: () => undefined });
  const medusa = postgres(MEDUSA_URL, { max: 1, onnotice: () => undefined });
  try {
    const skus = await core<
      {
        id: string;
        code: string;
        name: string | null;
        option_key: string | null;
        group_code: string | null;
        group_name: string | null;
        barcode: string | null;
        on_hand: number;
      }[]
    >`
      select s.id, s.code, s.name, s.option_key, g.code as group_code, g.name as group_name,
             (select b.barcode from sku_barcodes b where b.sku_id = s.id order by b.is_primary desc, b.created_at limit 1) as barcode,
             coalesce((select sum(l.qty) from stock_ledgers l
                        where l.sku_id = s.id and l.warehouse_id = ${BUCHEON_WAREHOUSE_ID} and l.stock_state = 'ON_HAND'), 0)::int as on_hand
        from skus s left join sku_groups g on g.id = s.group_id
       where not s.is_deleted
       order by s.code`;
    const taken = new Set((await core<{ barcode: string }[]>`select barcode from sku_barcodes`).map((r) => r.barcode));

    const items: Record<string, Item> = {};
    skus.forEach((s, i) => {
      const barcode2 = i % 5 === 0 ? `880${String(9_000_000_000 + i)}` : '';
      items[s.code] = {
        productCode: s.group_code ?? s.code,
        productSerial: `RH-${s.group_code ?? s.code}`,
        productName: s.group_name ?? s.name ?? s.code,
        optionName: s.group_code ? (s.option_key ?? s.name ?? s.code) : '단일상품',
        // 바코드 없는 SKU 는 셀메이트 쪽에서도 SKU 코드를 바코드로 쓴다고 본다 — 업로드가 바코드로 맞추므로 빈 값은 못 맞춘다
        barcode: s.barcode ?? s.code,
        barcode2: barcode2 && !taken.has(barcode2) ? barcode2 : '',
        current: s.on_hand,
        position: positionFor(i),
      };
    });

    // 넘긴 자사몰 주문 = core 에 출고주문 항목이 있고 아직 안 나간 Medusa 주문. 셀메이트가 이미 미발송으로 들고 있다.
    const open = await core<{ channel_order_id: string; sku_code: string; qty: number }[]>`
      select so.channel_order_id, s.code as sku_code, sum(foi.qty - coalesce(foi.canceled_qty, 0))::int as qty
        from sales_orders so
        join fulfillment_orders fo on fo.sales_order_id = so.id
        join fulfillment_order_items foi on foi.fulfillment_order_id = fo.id
        join skus s on s.id = foi.sku_id
       where so.sales_channel = 'medusa' and so.status::text not in ('shipped', 'delivered', 'cancelled', 'canceled')
       group by 1, 2 having sum(foi.qty - coalesce(foi.canceled_qty, 0)) > 0`;
    const ids = [...new Set(open.map((r) => r.channel_order_id))];
    const mo = ids.length
      ? await medusa<{ id: string; display_id: number; created_at: Date }[]>`
          select id, display_id, created_at from "order" where id = any(${ids}) and deleted_at is null order by display_id`
      : [];
    const orders: Order[] = mo.slice(0, maxHanded).map((o) => ({
      channel: OWN_MALL_CHANNEL,
      orderNo: `${kstStamp(o.created_at).slice(0, 8)}-${o.display_id}`,
      lines: open.filter((r) => r.channel_order_id === o.id).map((r) => ({ serial: r.sku_code, qty: r.qty })),
      state: 'unshipped',
    }));
    const state: State = { items, orders: [...orders], marketSeq: 0, log: [] };
    addMarketOrders(state, market);

    // 마지막 sync 가 맞출 값(현재 − 미발송)이 core ON_HAND 와 같게 현재재고를 잡는다. drift 개 품목만 ±1 어긋나게 해 sync 가 조정할 거리를 둔다.
    const unshipped = unshippedBySerial(state);
    Object.entries(state.items).forEach(([serial, it], i) => {
      it.current += unshipped.get(serial) ?? 0;
      if (i < drift) it.current += i % 2 === 0 ? 1 : -1;
      if (it.current < 0) it.current = 0;
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    saveState(
      state,
      `init 품목 ${skus.length} · 넘긴 자사몰 주문 ${orders.length} · 마켓 주문 ${market} · 어긋남 ${drift}`,
    );
    console.log(
      `품목 ${skus.length} · 넘긴 자사몰 주문 ${orders.length}(${orders.map((o) => o.orderNo).join(', ') || '없음'}) · 마켓 주문 ${market}`,
    );
    console.log(`상태 → ${STATE_FILE}. 다음: export`);
  } finally {
    await core.end();
    await medusa.end();
  }
}

function addMarketOrders(state: State, count: number): Order[] {
  const serials = Object.entries(state.items)
    .sort((a, b) => b[1].current - a[1].current)
    .map(([s]) => s);
  const made: Order[] = [];
  for (let i = 0; i < count && serials.length; i++) {
    state.marketSeq += 1;
    const o: Order = {
      channel: MARKET_CHANNEL,
      orderNo: `NV-${String(state.marketSeq).padStart(6, '0')}`,
      lines: [{ serial: serials[i % serials.length], qty: 1 }],
      state: 'unshipped',
    };
    state.orders.push(o);
    made.push(o);
  }
  return made;
}

function exportFiles(): void {
  const state = loadState();
  const at = new Date();
  const stamp = kstStamp(at);
  const unshipped = unshippedBySerial(state);
  const stock = writeXls(
    `stk_stockList_${stamp}.xls`,
    STOCK_HEADER,
    Object.entries(state.items).map(([serial, it]) => [
      it.productCode,
      it.productSerial,
      it.productName,
      serial,
      it.optionName,
      it.barcode,
      it.barcode2,
      it.current,
      unshipped.get(serial) ?? 0,
      it.position,
      '',
    ]),
  );
  const orders = writeXls(
    `sm_unshipped_${stamp}.xls`,
    ORDER_HEADER,
    state.orders
      .filter((o) => o.state === 'unshipped')
      .flatMap((o) => o.lines.map((l) => [o.channel, o.orderNo, l.serial, l.qty])),
  );
  saveState(state, `export ${stamp}`);
  console.log(`재고 현황   ${stock}`);
  console.log(`미발송 주문 ${orders}`);
  console.log(`스냅샷 시각 ${kstIso(at)}  (런북 §3 의 T 는 이 시각 이상)`);
}

function ship(args: string[]): void {
  const state = loadState();
  const channel = flag(args, 'channel') ?? 'all';
  const count = num(flag(args, 'count'), Number.MAX_SAFE_INTEGER);
  const want = (o: Order) =>
    o.state === 'unshipped' && (channel === 'all' || (channel === 'own') === (o.channel === OWN_MALL_CHANNEL));
  const picked = state.orders.filter(want).slice(0, count);
  shipOrders(state, picked);
  const own = picked.filter((o) => o.channel === OWN_MALL_CHANNEL);
  const stamp = kstStamp(new Date());
  saveState(state, `ship ${picked.length} (자사몰 ${own.length})`);
  console.log(`내보냄 ${picked.length}건 (자사몰 ${own.length} · 마켓 ${picked.length - own.length})`);
  if (own.length) {
    const file = writeXls(
      `sm_shipped_${stamp}.xls`,
      ORDER_HEADER,
      own.flatMap((o) => o.lines.map((l) => [o.channel, o.orderNo, l.serial, l.qty])),
    );
    console.log(`출고 주문 파일 ${file}   (mark-shipped-from-csv 입력)`);
    console.log(
      `DISPLAY_IDS=${own.map((o) => o.orderNo.split('-')[1]).join(',')}   (mark-core-shipped · mark-medusa-shipped)`,
    );
  }
}

function main(): Promise<void> | void {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init':
      return init(args);
    case 'export':
      return exportFiles();
    case 'market-order': {
      const state = loadState();
      const made = addMarketOrders(state, num(flag(args, 'count'), 1));
      saveState(state, `market-order ${made.length}`);
      return console.log(`마켓 새 주문 ${made.map((o) => `${o.orderNo}(${o.lines[0].serial})`).join(', ')}`);
    }
    case 'cancel-market': {
      const state = loadState();
      const picked = state.orders
        .filter((o) => o.state === 'unshipped' && o.channel === MARKET_CHANNEL)
        .slice(0, num(flag(args, 'count'), 1));
      picked.forEach((o) => (o.state = 'canceled'));
      saveState(state, `cancel-market ${picked.length}`);
      return console.log(`마켓 취소 ${picked.map((o) => o.orderNo).join(', ') || '없음'}`);
    }
    case 'ship':
      return ship(args);
    case 'return': {
      const state = loadState();
      const serial = flag(args, 'serial');
      if (!serial || !state.items[serial]) throw new Error(`--serial <옵션정보일련번호> — 없는 품목: ${serial}`);
      const qty = num(flag(args, 'qty'), 1);
      state.items[serial].current += qty;
      saveState(state, `return ${serial} +${qty}`);
      return console.log(`반품 입고 ${serial} +${qty} → 현재재고 ${state.items[serial].current}`);
    }
    case 'upload': {
      const file = args[0];
      if (!file) throw new Error('upload <업로드 CSV>');
      const state = loadState();
      const lines = parseUploadCsv(iconv.decode(fs.readFileSync(file), process.env.UPLOAD_ENCODING || 'euc-kr'));
      const unknown = applyUpload(state, lines);
      saveState(state, `upload ${path.basename(file)} ${lines.length}행`);
      console.log(`업로드 ${lines.length}행 반영${unknown.length ? ` · 못 찾은 바코드 ${unknown.join(', ')}` : ''}`);
      return;
    }
    case 'status': {
      const state = loadState();
      const by = (s: Order['state'], ch: string) =>
        state.orders.filter((o) => o.state === s && o.channel === ch).length;
      console.log(`품목 ${Object.keys(state.items).length}`);
      console.log(`자사몰 미발송 ${by('unshipped', OWN_MALL_CHANNEL)} · 출고 ${by('shipped', OWN_MALL_CHANNEL)}`);
      console.log(
        `마켓   미발송 ${by('unshipped', MARKET_CHANNEL)} · 출고 ${by('shipped', MARKET_CHANNEL)} · 취소 ${by('canceled', MARKET_CHANNEL)}`,
      );
      console.log(state.log.slice(-8).join('\n'));
      return;
    }
    default:
      console.error(
        '명령: init · export · market-order · cancel-market · ship · return · upload · status (파일 머리 주석)',
      );
      process.exit(2);
  }
}

if (require.main === module) {
  Promise.resolve(main()).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
