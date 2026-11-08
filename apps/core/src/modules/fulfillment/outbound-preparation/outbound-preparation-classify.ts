import { compatibleShippingProfileId } from '../services/shipping-profile';

// 분류 이름의 정본. 응답 순서·쿼리 검증·타입이 모두 여기서 나온다.
export const PREPARATION_BUCKETS = ['ready', 'partial', 'unavailable', 'mergeable', 'resume', 'needs_info'] as const;
export type PreparationBucket = (typeof PREPARATION_BUCKETS)[number];

export interface PreparationFacts {
  status: 'draft' | 'planned';
  hasActiveWorkItem: boolean;
  lines: { qty: number; confirmedQty: number }[];
  profileIds: (string | null)[];
  recipientComplete: boolean;
  consolidationPeerLines: PreparationFacts['lines'][];
}

export function classifyPreparation(f: PreparationFacts): PreparationBucket | null {
  if (f.hasActiveWorkItem) {
    return null;
  }

  if (f.status === 'planned') {
    return 'resume';
  }

  // 라인이 0개인 상자도 여기 걸린다 — 보낼 것이 없으니 출고불가가 맞다.
  if (f.lines.every((line) => line.confirmedQty === 0)) {
    return 'unavailable';
  }

  if (f.lines.some((line) => line.confirmedQty < line.qty)) {
    return 'partial';
  }

  if (compatibleShippingProfileId(f.profileIds) === null || !f.recipientComplete) {
    return 'needs_info';
  }

  if (
    f.consolidationPeerLines.some((lines) => lines.length > 0 && lines.every((line) => line.confirmedQty === line.qty))
  ) {
    return 'mergeable';
  }

  return 'ready';
}

export function isSingleItem(lines: { qty: number }[]): boolean {
  return lines.length === 1;
}
