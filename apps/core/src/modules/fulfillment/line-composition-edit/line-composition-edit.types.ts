import {
  CompositionItem,
  CompositionSource,
  sameComposition,
} from '../../product-matching/line-composition/line-composition';

export interface BoxOfLine {
  shipmentId: string;
  status: string;
  /** 활성 작업 항목의 배치. 없으면 null */
  batchId: string | null;
  hasActiveWaybill: boolean;
}

/** 수정할 수 없는 박스 — draft 가 아니거나, draft 여도 작업·송장에 묶였다(스펙 D5). 사전 판정이고 amend 가 잠금 아래에서 다시 막는다. */
export function isBlockingBox(box: BoxOfLine): boolean {
  return box.status !== 'draft' || box.batchId !== null || box.hasActiveWaybill;
}

export type ExistingLineClass = 'changeable' | 'operator' | 'in_progress' | 'same';

/** 일괄 적용 대상 판정(스펙 §7.2). 개별 지정이 먼저, 같음이 그다음 — 같은 구성이면 박스 상태와 무관하게 할 일이 없다. */
export function classifyExistingLine(input: {
  source: CompositionSource;
  frozen: readonly CompositionItem[];
  next: readonly CompositionItem[];
  blocked: boolean;
}): ExistingLineClass {
  if (input.source === 'operator') return 'operator';
  if (sameComposition(input.frozen, input.next)) return 'same';
  if (input.blocked) return 'in_progress';
  return 'changeable';
}

export type ApplySkipReason = 'operator' | 'in_progress' | 'same' | 'units_ambiguous' | 'not_applicable';

export interface LineCompositionChangeResult {
  salesOrderLineId: string;
  source: CompositionSource;
  items: CompositionItem[];
  changedShipmentIds: string[];
  amendmentId: string | null;
}

export interface ExistingLinesImpact {
  variantId: string;
  applicable: boolean;
  newComposition: CompositionItem[] | null;
  changeable: number;
  skippedOperator: number;
  skippedInProgress: number;
  alreadySame: number;
}

export interface ApplyToExistingLinesResult {
  changed: number;
  skipped: Array<{ reason: ApplySkipReason; count: number }>;
}
