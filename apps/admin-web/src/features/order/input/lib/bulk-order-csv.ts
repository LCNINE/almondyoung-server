import type { CreateSalesOrderDto } from '@/lib/types/dto/orders';
import { buildManualOrder, isUuid } from './manual-order';

/** 양식 열. 같은 orderNo 의 행은 한 주문으로 묶이고, 주문 정보(고객·받는 분·메모)는 첫 행 기준이다. */
export const BULK_ORDER_COLUMNS = [
  'orderNo',
  'customerId',
  'buyerName',
  'buyerPhone',
  'buyerEmail',
  'recipientName',
  'recipientPhone',
  'zip',
  'addr1',
  'addr2',
  'msg',
  'variantId',
  'quantity',
  'unitPrice',
  'memo',
] as const;

type Column = (typeof BULK_ORDER_COLUMNS)[number];

const REQUIRED: Column[] = [
  'orderNo',
  'recipientName',
  'recipientPhone',
  'zip',
  'addr1',
  'addr2',
  'variantId',
  'quantity',
  'unitPrice',
];

/** 주문 단위 칸 — 같은 주문의 행끼리 값이 달라서는 안 된다 */
const ORDER_COLUMNS: Column[] = [
  'customerId',
  'buyerName',
  'buyerPhone',
  'buyerEmail',
  'recipientName',
  'recipientPhone',
  'zip',
  'addr1',
  'addr2',
  'msg',
  'memo',
];

/** 엑셀이 한글 CSV 를 제대로 열도록 붙이는 BOM. 포맷터가 이스케이프를 문자로 바꾸지 않게 코드로 만든다. */
export const CSV_BOM = String.fromCharCode(0xfeff);

const LEGACY_COLUMNS = ['skuId', 'warehouseId', 'channelType', 'channelId'];

export type BulkRow = { lineNo: number } & Record<Column, string>;

export type ParsedCsv = {
  rows: string[][];
  /** 따옴표가 끝까지 닫히지 않았으면 그 따옴표가 시작한 행 번호(1부터) */
  unclosedQuoteRow: number | null;
};

/** RFC 4180 CSV. 따옴표 안의 쉼표·줄바꿈·"" 를 처리하고 엑셀이 붙이는 BOM 을 뗀다. */
export function parseCsv(input: string): ParsedCsv {
  const textValue = input.startsWith(CSV_BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quoteStartRow = 0;
  for (let i = 0; i < textValue.length; i += 1) {
    const ch = textValue[i];
    if (quoted) {
      if (ch === '"') {
        if (textValue[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      quoteStartRow = rows.length + 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textValue[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows, unclosedQuoteRow: quoted ? quoteStartRow : null };
}

const isBlank = (cells: string[]) => cells.every((cell) => cell.trim() === '');

const csvCell = (value: string | number) => {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export type ReadResult =
  | { rows: BulkRow[]; fileIssues: [] }
  | { rows: []; fileIssues: string[] };

export function readBulkOrderCsv(input: string): ReadResult {
  // 행 번호는 엑셀의 행 번호와 같아야 한다 — 빈 행을 버리기 전에 매긴다
  const parsed = parseCsv(input);
  // 닫히지 않은 따옴표는 뒤의 주문을 한 칸에 삼킨다 — 일부만 저장되지 않게 파일째 막는다
  if (parsed.unclosedQuoteRow !== null)
    return {
      rows: [],
      fileIssues: [
        `${parsed.unclosedQuoteRow}행에서 시작한 따옴표(")가 닫히지 않았습니다. 그 행의 칸을 확인해 주세요.`,
      ],
    };
  const [header, ...records] = parsed.rows;
  if (!header || isBlank(header))
    return {
      rows: [],
      fileIssues: ['빈 파일입니다. 양식을 내려받아 작성해 주세요.'],
    };
  const names = header.map((h) => h.trim());
  if (
    LEGACY_COLUMNS.some((c) => names.includes(c)) &&
    !names.includes('variantId')
  )
    return {
      rows: [],
      fileIssues: [
        '이전 양식입니다. 「양식 내려받기」로 새 양식을 받아 다시 작성해 주세요.',
      ],
    };
  const missing = REQUIRED.filter((c) => !names.includes(c));
  if (missing.length > 0)
    return {
      rows: [],
      fileIssues: [`필수 열이 없습니다: ${missing.join(', ')}`],
    };
  const rows = records.flatMap((cells, index) => {
    if (isBlank(cells)) return [];
    const row = { lineNo: index + 2 } as BulkRow;
    BULK_ORDER_COLUMNS.forEach((column) => {
      const at = names.indexOf(column);
      row[column] = at >= 0 ? (cells[at] ?? '').trim() : '';
    });
    return [row];
  });
  if (rows.length === 0)
    return { rows: [], fileIssues: ['주문 행이 없습니다.'] };
  return { rows, fileIssues: [] };
}

/** 미리 확인할 옵션 ID — 형식이 맞는 것만(형식 오류는 행 검증이 따로 잡는다) */
export function variantIdsOf(rows: BulkRow[]): string[] {
  return [...new Set(rows.map((r) => r.variantId).filter(isUuid))];
}

export type VariantLookup = Map<string, { label: string }>;

export type BulkOrder = {
  orderNo: string;
  lineNos: number[];
  payload: CreateSalesOrderDto | null;
  issues: string[];
};

const toNumber = (value: string) =>
  value === '' ? NaN : Number(value.replace(/,/g, ''));

/**
 * 행을 주문으로 묶고 행 번호와 함께 한국어로 검증한다.
 * variants 가 없으면(조회 전·실패) 옵션 존재 확인을 건너뛰지 않고 그 주문을 막는다.
 */
export function groupBulkOrders(
  rows: BulkRow[],
  variants: VariantLookup | null
): BulkOrder[] {
  const byOrder = new Map<string, BulkRow[]>();
  const orphanRows: BulkRow[] = [];
  rows.forEach((row) => {
    if (!row.orderNo) orphanRows.push(row);
    else byOrder.set(row.orderNo, [...(byOrder.get(row.orderNo) ?? []), row]);
  });

  const orders: BulkOrder[] = [...byOrder.entries()].map(([orderNo, group]) => {
    const issues: string[] = [];
    const first = group[0];
    group.slice(1).forEach((row) => {
      const differs = ORDER_COLUMNS.filter((c) => row[c] !== first[c]);
      if (differs.length > 0)
        issues.push(
          `[${row.lineNo}행] 같은 주문번호의 ${first.lineNo}행과 주문 정보가 다릅니다 (${differs.join(', ')}). 한 주문의 행은 상품 칸만 달라야 합니다.`
        );
    });

    const lines = group.map((row) => {
      const variant = variants?.get(row.variantId);
      if (!isUuid(row.variantId))
        issues.push(`[${row.lineNo}행] variantId 가 옵션 ID 형식이 아닙니다.`);
      else if (variants === null)
        issues.push(
          `[${row.lineNo}행] 상품 정보를 아직 확인하지 못했습니다. 잠시 뒤 다시 확인해 주세요.`
        );
      else if (!variant)
        issues.push(
          `[${row.lineNo}행] 판매 중인 상품 옵션을 찾을 수 없습니다 (${row.variantId}).`
        );
      const quantity = toNumber(row.quantity);
      if (!Number.isInteger(quantity) || quantity < 1)
        issues.push(
          `[${row.lineNo}행] quantity 는 1 이상의 정수로 적어 주세요.`
        );
      const unitPrice = toNumber(row.unitPrice);
      if (!Number.isInteger(unitPrice) || unitPrice < 0)
        issues.push(
          `[${row.lineNo}행] unitPrice 는 원 단위 정수로 적어 주세요. 무상이면 0.`
        );
      return {
        variantId: row.variantId,
        label: variant?.label ?? `${row.lineNo}행 상품`,
        quantity,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
      };
    });

    const built = buildManualOrder({
      orderNo,
      customerId: first.customerId,
      buyer: {
        name: first.buyerName,
        phone: first.buyerPhone,
        email: first.buyerEmail,
      },
      recipient: {
        name: first.recipientName,
        phone: first.recipientPhone,
        postalCode: first.zip,
        roadAddress: first.addr1,
        detailAddress: first.addr2,
        deliveryNote: first.msg,
      },
      lines,
      memo: first.memo,
    });
    // 상품 줄 문제는 위에서 행 번호와 함께 적었다 — 주문 칸 문제만 첫 행 번호로 덧붙인다
    built.issues
      .filter((issue) => issue.field !== 'lines')
      .forEach((issue) => issues.push(`[${first.lineNo}행] ${issue.message}`));

    return {
      orderNo,
      lineNos: group.map((r) => r.lineNo),
      payload: issues.length === 0 ? built.payload : null,
      issues,
    };
  });

  return orphanRows.length > 0
    ? [
        {
          orderNo: '',
          lineNos: orphanRows.map((r) => r.lineNo),
          payload: null,
          issues: orphanRows.map(
            (r) => `[${r.lineNo}행] orderNo 를 입력해 주세요.`
          ),
        },
        ...orders,
      ]
    : orders;
}
