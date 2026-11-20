import type {
  NeedsInfoIssue,
  PreparationLineDto,
  PreparationLineStock,
} from '@/lib/types/dto/fulfillment';

const RECIPIENT_FIELD_LABELS: Record<string, string> = {
  recipientName: '받는 분 이름',
  phone: '연락처',
  postalCode: '우편번호',
  roadAddress: '주소',
};

// 'YYYY-MM-DD' 를 달력일 그대로 읽는다(시간대 변환 없음)
export function etaText(date: string | null): string | null {
  const match = date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(date) : null;

  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : null;
}

function withEta(text: string, eta: string | null, suffix: string): string {
  const day = etaText(eta);

  return day ? `${text}(${day} ${suffix})` : text;
}

/** 출고불가 줄: 주문 수량, 이 창고 재고와 그중 다른 주문 몫, 모자란 수량 */
export function shortageLineText(
  line: Pick<PreparationLineDto, 'qty' | 'reservedQty'> & {
    stock: PreparationLineStock;
  }
): string {
  const short = Math.max(0, line.qty - line.reservedQty);
  const { onHand, reservedByOthers } = line.stock;
  const stock =
    onHand > 0 && reservedByOthers > 0
      ? `이 창고 재고 ${onHand} (다른 주문 몫 ${Math.min(onHand, reservedByOthers)})`
      : `이 창고 재고 ${Math.max(0, onHand)}`;

  return `주문 ${line.qty} · ${stock} · 모자람 ${short}`;
}

/** 모자란 상품이 언제·어디서 오는지. 남는 재고 → 이 창고로 오는 것 → 다른 창고에 있는 것 순 */
export function incomingText(stock: PreparationLineStock): string {
  const { incoming, elsewhere } = stock;
  // 재고가 막 들어와 아직 확보 전이면 발주·이동을 권하지 않는다(확보는 주기적으로 오래 기다린 주문부터 한다)
  const free = Math.max(0, stock.onHand - stock.reservedByOthers);
  const coming = incoming
    ? [
        incoming.inTransit > 0 &&
          withEta(
            `이동 중 ${incoming.inTransit}개`,
            incoming.inTransitEta,
            '도착 예정'
          ),
        incoming.ordered > 0 && `발주 ${incoming.ordered}개`,
        incoming.inboundShipment > 0 &&
          withEta(
            `선적 ${incoming.inboundShipment}개`,
            incoming.inboundShipmentEta,
            '도착 예정'
          ),
      ].filter((part): part is string => typeof part === 'string')
    : [];
  const away = elsewhere
    ? [
        elsewhere.onHand > 0 &&
          `다른 창고에 ${elsewhere.onHand}개 — 옮겨 와야 해요`,
        elsewhere.ordered > 0 &&
          withEta(
            `다른 창고로 발주 ${elsewhere.ordered}개`,
            elsewhere.orderedEta,
            '입고 예정'
          ),
      ].filter((part): part is string => typeof part === 'string')
    : [];

  if (
    incoming &&
    elsewhere &&
    free === 0 &&
    coming.length === 0 &&
    away.length === 0
  ) {
    return '들어올 예정이 없어요 — 발주하거나 다른 창고에서 옮겨 와야 해요';
  }

  return [
    free > 0 && `이 창고에 남는 재고 ${free}개 — 곧 자동으로 확보돼요`,
    incoming
      ? coming.length > 0
        ? `이 창고로 올 것: ${coming.join(', ')}`
        : '이 창고로 올 것은 없어요'
      : '이 창고로 올 것은 입고 화면에서 확인해 주세요',
    ...away,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' · ');
}

export interface NeedsInfoCopy {
  problem: string;
  skus: { label: string; href: string | null }[];
  fix: string;
}

const skuHref = (code: string) =>
  `/inventory/skus?code=${encodeURIComponent(code)}`;

/** 고칠 곳이 모두 화면에 있으면, 다 고친 뒤 상자가 정보 부족에서 빠진다고 한 번 알린다 */
export function needsInfoClosing(issues: NeedsInfoIssue[]): string | null {
  if (
    issues.length === 0 ||
    issues.some((issue) => issue.kind === 'channel_item_unknown')
  ) {
    return null;
  }

  return issues.length > 1
    ? '모두 고치면 이 상자는 정보 부족에서 빠져요'
    : '고치면 이 상자는 정보 부족에서 빠져요';
}

/** 정보 부족 문제마다 무엇이 비었는지와 고치는 곳 */
export function needsInfoCopy(
  issue: NeedsInfoIssue,
  place: 'list' | 'detail' = 'list'
): NeedsInfoCopy {
  const here = place === 'detail' ? '' : '상자 상세에서 ';

  switch (issue.kind) {
    case 'shipping_profile_missing':
      return {
        problem: '배송 프로필이 없는 상품',
        skus: issue.skus.map((sku) => ({
          label: sku.name,
          href: skuHref(sku.code),
        })),
        fix: 'SKU 에서 배송 프로필을 정해 주세요',
      };
    case 'shipping_profile_mixed':
      return {
        problem: '배송 프로필이 상품마다 달라요',
        skus: issue.skus.map((sku) => ({
          label: `${sku.name} «${sku.profileName}»`,
          href: skuHref(sku.code),
        })),
        fix:
          place === 'detail'
            ? 'SKU 의 배송 프로필을 같게 맞추거나, «분할»로 상자를 나눠 주세요'
            : 'SKU 의 배송 프로필을 같게 맞추거나, 상자를 배송 프로필별로 나눠 주세요',
      };
    case 'recipient_incomplete':
      return {
        problem: `수령인 정보의 ${
          issue.fields
            .map((field) => RECIPIENT_FIELD_LABELS[field] ?? field)
            .join('·') || '필수'
        } 칸이 비어 있어요`,
        skus: [],
        fix: `${here}«수령인 변경»으로 채워 주세요`,
      };
    case 'channel_item_unknown':
      return {
        problem: '쇼핑몰 품목 번호가 없거나 맞지 않는 상품',
        skus: issue.skus.map((sku) => ({ label: sku.name, href: null })),
        fix: '쇼핑몰에 어느 품목이 나갔는지 알릴 수 없어 다시 시도해도 같아요 — 담당자에게 알려 주세요',
      };
  }
}
