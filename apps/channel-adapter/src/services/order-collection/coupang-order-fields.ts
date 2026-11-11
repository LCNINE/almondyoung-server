import { z } from 'zod';
import type { ShippingAddress } from '@packages/event-contracts/streams';
import { CoupangLongIdSchema, CoupangOrderStatusSchema } from '../../zods/coupang/coupang-common.zod';

/**
 * 쿠팡 발주서·출고중지요청(취소 접수)의 **우리가 읽는 부분만** 좁힌 모양. 쿠팡 응답 해석은 이 파일 한 곳에서 한다.
 *
 * `looseObject` 가 요점이다: 모르는 필드는 통과시키고, **우리가 의존하는 필드가 없으면 칸 이름을 담아 throw** 한다.
 * 삼키면 라인이 조용히 빠진 주문이 Core 로 들어간다. 긴 ID(`shipmentBoxId`·`orderId`·`receiptId`)는
 * 클라이언트(`parseCoupangJson`)가 이미 문자열로 만들어 둔 것이며, 여기서도 문자열만 받는다.
 *
 * **🔴 리허설(스펙 §4.8) 응답으로 확정할 추정** — 틀렸으면 **여기만** 고친다:
 * - 시각 문자열에 offset 이 없으면 KST(`+09:00`)다.
 * - 수취인 연락처는 `receiverNumber ?? safeNumber` (실번호가 없으면 안심번호).
 * - 배송 메모는 `parcelPrintMessage` 다.
 * - `shippingPrice` 가 상자(발주서) 단위 배송비다.
 *
 * `cancelCount`·`holdCountForCancel` 이 없으면 0 으로 본다(산술이 NaN 이 되지 않게).
 * `shippingCount`·`vendorItemId` 가 없으면 throw 한다.
 */

const MoneySchema = z.looseObject({ units: z.number() });

const OrderItemSchema = z.looseObject({
  vendorItemId: z.number(),
  vendorItemName: z.string().optional(),
  shippingCount: z.number().int().nonnegative(),
  cancelCount: z.number().int().nonnegative().nullish(),
  holdCountForCancel: z.number().int().nonnegative().nullish(),
  salesPrice: MoneySchema,
  orderPrice: MoneySchema,
});

const ReceiverSchema = z.looseObject({
  name: z.string(),
  safeNumber: z.string().nullish(),
  receiverNumber: z.string().nullish(),
  addr1: z.string(),
  addr2: z.string().nullish(),
  postCode: z.string().nullish(),
});

const OrderSheetSchema = z.looseObject({
  shipmentBoxId: CoupangLongIdSchema,
  orderId: CoupangLongIdSchema,
  status: CoupangOrderStatusSchema,
  orderedAt: z.string().min(1),
  paidAt: z.string().min(1),
  shippingPrice: MoneySchema.nullish(),
  receiver: ReceiverSchema,
  parcelPrintMessage: z.string().nullish(),
  // 빈 목록은 받지 않는다 — 품목이 없으면 «전 품목 취소»(every 가 빈 목록에 참)로 읽혀 주문이 종결된다.
  orderItems: z.array(OrderItemSchema).min(1),
});

const CancelReceiptSchema = z.looseObject({
  receiptId: CoupangLongIdSchema,
  orderId: CoupangLongIdSchema,
  receiptStatus: z.string(),
  createdAt: z.string().min(1),
  cancelCountSum: z.number(),
  returnItems: z.array(
    z.looseObject({
      vendorItemId: z.number(),
      cancelCount: z.number(),
    }),
  ),
});

export interface CoupangOrderItemInfo {
  vendorItemId: string;
  productName: string;
  shippingCount: number;
  cancelCount: number;
  holdCountForCancel: number;
  /** `salesPrice.units` */
  unitPrice: number;
  /** `orderPrice.units` */
  orderPrice: number;
}

export interface CoupangOrderSheetInfo {
  shipmentBoxId: string;
  orderId: string;
  status: z.infer<typeof CoupangOrderStatusSchema>;
  /** UTC ISO */
  orderedAt: string;
  /** UTC ISO */
  paidAt: string;
  shippingPrice: number;
  shippingAddress: ShippingAddress;
  items: CoupangOrderItemInfo[];
}

export interface CoupangCancelReceiptInfo {
  receiptId: string;
  orderId: string;
  receiptStatus: string;
  /** UTC ISO */
  createdAt: string;
  cancelCountSum: number;
  items: Array<{ vendorItemId: string; cancelCount: number }>;
}

const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** 쿠팡 시각을 계약 시각(UTC ISO)으로. offset 이 없으면 KST. 읽을 수 없는 값은 그대로 둔다 — 계약 파싱이 알린다. */
export function toCoupangContractTimestamp(value: string): string {
  const withOffset = OFFSET.test(value) ? value : `${value}+09:00`;
  const parsed = new Date(withOffset);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function fieldPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    const name = String(key);
    return acc ? `${acc}.${name}` : name;
  }, '');
}

function parseOrThrow<T extends z.ZodType>(schema: T, raw: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${fieldPath(issue.path) || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`${what} 해석 실패 — ${detail}`);
}

/** 비었거나 공백뿐인 값은 없는 것으로 보고 다음 후보를 쓴다. 전부 없으면 ''. */
function firstNonBlank(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (value != null && value.trim() !== '') return value;
  }
  return '';
}

export function parseCoupangOrderSheet(raw: unknown): CoupangOrderSheetInfo {
  const sheet = parseOrThrow(OrderSheetSchema, raw, '쿠팡 발주서');
  const { receiver } = sheet;
  return {
    shipmentBoxId: sheet.shipmentBoxId,
    orderId: sheet.orderId,
    status: sheet.status,
    orderedAt: toCoupangContractTimestamp(sheet.orderedAt),
    paidAt: toCoupangContractTimestamp(sheet.paidAt),
    shippingPrice: sheet.shippingPrice?.units ?? 0,
    shippingAddress: {
      recipientName: receiver.name,
      phone: firstNonBlank(receiver.receiverNumber, receiver.safeNumber),
      postalCode: receiver.postCode ?? '',
      roadAddress: receiver.addr1,
      detailAddress: receiver.addr2 ?? '',
    },
    items: sheet.orderItems.map((item) => ({
      vendorItemId: String(item.vendorItemId),
      productName: item.vendorItemName ?? String(item.vendorItemId),
      shippingCount: item.shippingCount,
      cancelCount: item.cancelCount ?? 0,
      holdCountForCancel: item.holdCountForCancel ?? 0,
      unitPrice: item.salesPrice.units,
      orderPrice: item.orderPrice.units,
    })),
  };
}

export function parseCoupangCancelReceipt(raw: unknown): CoupangCancelReceiptInfo {
  const receipt = parseOrThrow(CancelReceiptSchema, raw, '쿠팡 출고중지요청');
  return {
    receiptId: receipt.receiptId,
    orderId: receipt.orderId,
    receiptStatus: receipt.receiptStatus,
    createdAt: toCoupangContractTimestamp(receipt.createdAt),
    cancelCountSum: receipt.cancelCountSum,
    items: receipt.returnItems.map((item) => ({
      vendorItemId: String(item.vendorItemId),
      cancelCount: item.cancelCount,
    })),
  };
}
