// core line-composition-edit.dto.ts · line-composition-views.ts 의 응답 모양 (#1063)

export type CompositionSource = 'matching' | 'operator';

export interface CompositionItemInput {
  skuId: string;
  qtyPerUnit: number;
}

export interface CompositionItemView extends CompositionItemInput {
  skuCode: string;
  skuName: string;
}

export interface LineCompositionView {
  salesOrderLineId: string;
  productName: string;
  quantity: number;
  compositionSource: CompositionSource | null;
  composition: CompositionItemView[];
}

export interface PutLineCompositionRequest {
  items: CompositionItemInput[];
  note?: string;
}

export interface LineCompositionChangeResponse {
  salesOrderLineId: string;
  source: CompositionSource;
  items: CompositionItemInput[];
  changedShipmentIds: string[];
  amendmentId: string | null;
}

export interface ExistingLinesImpact {
  variantId: string;
  applicable: boolean;
  newComposition: CompositionItemInput[] | null;
  changeable: number;
  skippedOperator: number;
  skippedInProgress: number;
  alreadySame: number;
}

export type ApplySkipReason = 'operator' | 'in_progress' | 'same' | 'units_ambiguous' | 'not_applicable';

export interface ApplyToExistingLinesResult {
  changed: number;
  skipped: Array<{ reason: ApplySkipReason; count: number }>;
}
