import type { CreateSalesOrderDto } from '@/lib/types/dto/orders';

/** 관리자가 입력한 주문은 외부 연동이 없는 «수기·기타» 채널로 저장된다(취소·정산은 core 가 한다). */
export const MANUAL_ORDER_SALES_CHANNEL = '3pl' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORDER_NO_MAX = 255;

export const isUuid = (value: string) => UUID.test(value);

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 날짜 + 임의 6자. 새로고침해도 같은 번호가 다시 나오지 않는다. */
export function generateManualOrderNo(
  now: Date = new Date(),
  random: () => number = Math.random
): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += chars[Math.floor(random() * chars.length) % chars.length];
  }
  return `SO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${suffix}`;
}

export type ManualOrderLineInput = {
  variantId?: string;
  /** 오류 문구와 주문 줄 상품명에 쓰는 이름 */
  label: string;
  quantity: number;
  unitPrice: number | null;
};

export type ManualOrderInput = {
  orderNo: string;
  customerId?: string;
  buyer?: { name?: string; phone?: string; email?: string };
  recipient: {
    name: string;
    phone: string;
    postalCode: string;
    roadAddress: string;
    detailAddress: string;
    deliveryNote?: string;
  };
  lines: ManualOrderLineInput[];
  memo?: string;
};

export type ManualOrderField =
  | 'orderNo'
  | 'customerId'
  | 'buyerEmail'
  | 'recipientName'
  | 'recipientPhone'
  | 'postalCode'
  | 'roadAddress'
  | 'detailAddress'
  | 'lines';

export type ManualOrderIssue = { field: ManualOrderField; message: string };

export type ManualOrderResult =
  | { payload: CreateSalesOrderDto; issues: [] }
  | { payload: null; issues: ManualOrderIssue[] };

const text = (value: string | undefined) => (value ?? '').trim();

export function buildManualOrder(input: ManualOrderInput): ManualOrderResult {
  const issues: ManualOrderIssue[] = [];
  const add = (field: ManualOrderField, message: string) =>
    issues.push({ field, message });

  const orderNo = text(input.orderNo);
  if (!orderNo) add('orderNo', '주문번호를 입력해 주세요.');
  else if (orderNo.length > ORDER_NO_MAX)
    add('orderNo', `주문번호는 ${ORDER_NO_MAX}자 이하로 적어 주세요.`);

  const customerId = text(input.customerId);
  if (customerId && !isUuid(customerId))
    add(
      'customerId',
      '고객 ID 형식이 아닙니다. 유저검색으로 고르거나 비워 두세요.'
    );

  const buyerEmail = text(input.buyer?.email);
  if (buyerEmail && !EMAIL.test(buyerEmail))
    add('buyerEmail', '주문자 이메일 형식을 확인해 주세요.');

  const r = input.recipient;
  if (!text(r.name)) add('recipientName', '받는 분 이름을 입력해 주세요.');
  if (!text(r.phone)) add('recipientPhone', '받는 분 연락처를 입력해 주세요.');
  if (!text(r.postalCode)) add('postalCode', '우편번호를 입력해 주세요.');
  if (!text(r.roadAddress)) add('roadAddress', '주소를 입력해 주세요.');
  if (!text(r.detailAddress))
    add(
      'detailAddress',
      "상세 주소를 입력해 주세요. 없으면 '없음'이라고 적어 주세요."
    );

  if (input.lines.length === 0)
    add('lines', '주문상품을 1개 이상 담아 주세요.');
  input.lines.forEach((line) => {
    const name = line.label || '이름 없는 상품';
    if (!line.variantId || !isUuid(line.variantId))
      add('lines', `${name}: 판매상품 옵션으로 담아 주세요.`);
    if (!Number.isInteger(line.quantity) || line.quantity < 1)
      add('lines', `${name}: 수량은 1 이상의 정수로 적어 주세요.`);
    if (line.unitPrice == null || !Number.isFinite(line.unitPrice))
      add('lines', `${name}: 단가를 입력해 주세요. 무상이면 0을 적어 주세요.`);
    else if (!Number.isInteger(line.unitPrice))
      add('lines', `${name}: 단가는 원 단위 정수로 적어 주세요.`);
    else if (line.unitPrice < 0)
      add('lines', `${name}: 단가는 0 이상으로 적어 주세요.`);
  });

  if (issues.length > 0) return { payload: null, issues };

  const lines = input.lines.map((line) => {
    const unitPrice = line.unitPrice ?? 0;
    return {
      variantId: line.variantId as string,
      productName: line.label,
      quantity: line.quantity,
      unitPrice,
      totalPrice: unitPrice * line.quantity,
    };
  });
  const buyer = {
    ...(customerId ? { id: customerId } : {}),
    ...(text(input.buyer?.name) ? { name: text(input.buyer?.name) } : {}),
    ...(text(input.buyer?.phone) ? { phone: text(input.buyer?.phone) } : {}),
    ...(buyerEmail ? { email: buyerEmail } : {}),
  };
  const memo = text(input.memo);
  const deliveryNote = text(r.deliveryNote);

  return {
    issues: [],
    payload: {
      channelOrderId: orderNo,
      salesChannel: MANUAL_ORDER_SALES_CHANNEL,
      ...(Object.keys(buyer).length > 0 ? { customer: buyer } : {}),
      shippingAddress: {
        recipientName: text(r.name),
        phone: text(r.phone),
        postalCode: text(r.postalCode),
        roadAddress: text(r.roadAddress),
        detailAddress: text(r.detailAddress),
        ...(deliveryNote ? { deliveryNote } : {}),
      },
      lines,
      totalAmount: lines.reduce((sum, line) => sum + line.totalPrice, 0),
      shippingFee: 0,
      ...(memo ? { memo } : {}),
    },
  };
}

/** 저장 실패를 작업자가 할 일로 바꾼다. 같은 주문번호가 이미 있으면 서버 문장을 그대로 보여 준다. */
export function describeSaveError(error: unknown): {
  kind: 'duplicate' | 'invalid' | 'retry';
  message: string;
} {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;
  const serverMessage =
    error instanceof Error && error.message ? error.message : '';
  if (statusCode === 409)
    return {
      kind: 'duplicate',
      message: serverMessage || '같은 주문번호로 저장된 주문이 이미 있습니다.',
    };
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500)
    return {
      kind: 'invalid',
      message: `저장하지 못했습니다. 입력값을 확인해 주세요. (${serverMessage || statusCode})`,
    };
  return {
    kind: 'retry',
    message:
      '저장 결과를 확인하지 못했습니다. 같은 주문번호로 다시 저장하면 두 번 만들어지지 않습니다.',
  };
}
