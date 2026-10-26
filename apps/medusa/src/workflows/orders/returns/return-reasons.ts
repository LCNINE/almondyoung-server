import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

/**
 * 반품 택배비를 누가 내는가 — 사유가 정한다(K8 D4). operator 는 «기타»처럼 CS 가 접수할 때 고르는 사유다(설계 §4.2).
 * 부분취소의 ShippingFeeBearer('customer' | 'seller')와 일부러 따로 둔다 — 취소에는 «CS 가 고른다»가 없다.
 */
export type ReturnFeeBearer = 'customer' | 'seller' | 'operator';

export const RETURN_REASON_FEE_BEARER_KEY = 'feeBearer';
export const RETURN_REASON_CUSTOMER_SELECTABLE_KEY = 'customerSelectable';

/**
 * 반품 사유 표. 코드가 정본이다(PR2 N4) — 부팅 시드가 label·위 두 metadata 키를 이 값으로 덮어쓰고, 대시보드 쓰기는 막는다.
 * value 는 core 의 옛 return_reason_code 와 같은 집합이다. 기타는 스토어프론트에 보이지 않는다(CS 접수 전용).
 */
export const RETURN_REASONS: ReadonlyArray<{
  value: string;
  label: string;
  feeBearer: ReturnFeeBearer;
  customerSelectable: boolean;
}> = [
  { value: 'change_of_mind', label: '단순 변심', feeBearer: 'customer', customerSelectable: true },
  { value: 'defective', label: '상품 하자', feeBearer: 'seller', customerSelectable: true },
  { value: 'not_as_described', label: '상품 설명과 다름', feeBearer: 'seller', customerSelectable: true },
  { value: 'wrong_item', label: '오배송', feeBearer: 'seller', customerSelectable: true },
  { value: 'damaged_in_shipping', label: '배송 중 파손', feeBearer: 'seller', customerSelectable: true },
  { value: 'other', label: '기타', feeBearer: 'operator', customerSelectable: false },
];

const FEE_BEARERS: ReadonlySet<string> = new Set<ReturnFeeBearer>(['customer', 'seller', 'operator']);

/** 사유 행의 부담 주체. 셋 중 하나가 아니면 null — 정산은 null 이면 멈춘다(모르는 채로 고객에게 물리지 않게). */
export function readReturnFeeBearer(
  reason: { metadata?: Record<string, unknown> | null } | null | undefined,
): ReturnFeeBearer | null {
  const value = reason?.metadata?.[RETURN_REASON_FEE_BEARER_KEY];
  return typeof value === 'string' && FEE_BEARERS.has(value) ? (value as ReturnFeeBearer) : null;
}

/** 표의 6종을 보장한다. 없으면 만들고, label·두 metadata 키가 다르면 표 값으로 고친다. metadata 의 다른 키와 표 밖의 사유는 건드리지 않는다. */
export async function ensureReturnReasons(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const orderModuleService = container.resolve(Modules.ORDER);
  const existing = await orderModuleService.listReturnReasons({ value: RETURN_REASONS.map((r) => r.value) });

  for (const reason of RETURN_REASONS) {
    const wanted = {
      [RETURN_REASON_FEE_BEARER_KEY]: reason.feeBearer,
      [RETURN_REASON_CUSTOMER_SELECTABLE_KEY]: reason.customerSelectable,
    };
    const row = existing.find((r) => r.value === reason.value);
    if (!row) {
      await orderModuleService.createReturnReasons({ value: reason.value, label: reason.label, metadata: wanted });
      logger.info(`[return-reasons] 생성: ${reason.value}`);
      continue;
    }
    const metadata = row.metadata ?? {};
    const drifted =
      row.label !== reason.label ||
      metadata[RETURN_REASON_FEE_BEARER_KEY] !== reason.feeBearer ||
      metadata[RETURN_REASON_CUSTOMER_SELECTABLE_KEY] !== reason.customerSelectable;
    if (!drifted) continue;
    await orderModuleService.updateReturnReasons(row.id, { label: reason.label, metadata: { ...metadata, ...wanted } });
    logger.info(`[return-reasons] 표 값으로 되돌림: ${reason.value}`);
  }
}
