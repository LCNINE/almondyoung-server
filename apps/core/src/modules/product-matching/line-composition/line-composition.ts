import { MatchingForFulfillment, isVoidMatching, physicalSkuLinks } from '../fulfillable-matching';

/**
 * 판매주문 라인의 «적용 구성» 판정(#1063 스펙 §5.1). FO 생성·리컨실러·화면이 모두 이 판정 하나를 쓴다 —
 * 자리마다 판정을 따로 가지면 1회 지정으로 풀린 주문이 어느 화면에선 여전히 «미매칭»이 된다(14번 행이 그 증상이었다).
 * SQL 짝은 line-resolved.sql.ts — 둘이 같은 답을 내는지는 parity 통합 스펙이 지킨다.
 */
export type CompositionSource = 'matching' | 'operator';

export interface CompositionItem {
  skuId: string;
  qtyPerUnit: number;
}

export type MatchingFailureReason =
  | 'NO_PRODUCT_SKU_MATCHING'
  | 'LEGACY_PRODUCT_MATCHING_IGNORED'
  | 'PRODUCT_MATCHING_UNRESOLVED'
  | 'PRODUCT_MATCHING_STRATEGY_UNRESOLVED';

export type LineCompositionResolution =
  | { kind: 'digital' }
  | { kind: 'frozen'; source: CompositionSource; items: CompositionItem[] }
  | { kind: 'follow'; items: CompositionItem[] }
  | { kind: 'void' }
  | { kind: 'missing'; reason: MatchingFailureReason };

export interface LineForComposition {
  id: string;
  fulfillmentKind: string | null;
  requiresShipping: boolean | null;
  compositionSource: CompositionSource | null;
}

// null(미지정 — 기존 데이터·외부 채널)은 물리로 간주한다.
export function isDigitalFulfillmentLine(line: {
  fulfillmentKind?: string | null;
  requiresShipping?: boolean | null;
}): boolean {
  return line.fulfillmentKind === 'digital' || line.requiresShipping === false;
}

export function matchingFailureReason(matching: MatchingForFulfillment): MatchingFailureReason {
  if (!matching) return 'NO_PRODUCT_SKU_MATCHING';
  if (matching.status === 'ignored') return 'LEGACY_PRODUCT_MATCHING_IGNORED';
  if (matching.status !== 'matched') return 'PRODUCT_MATCHING_UNRESOLVED';
  if (matching.strategy !== 'variant') return 'PRODUCT_MATCHING_STRATEGY_UNRESOLVED';
  return 'NO_PRODUCT_SKU_MATCHING';
}

// 지문·비교가 순서에 흔들리지 않게 SKU 순으로 둔다
export function sortComposition(items: readonly CompositionItem[]): CompositionItem[] {
  return [...items].sort((a, b) => a.skuId.localeCompare(b.skuId));
}

export type MatchingComposition =
  | { kind: 'follow'; items: CompositionItem[] }
  | { kind: 'void' }
  | { kind: 'missing'; reason: MatchingFailureReason };

/** 상품매칭 하나가 정하는 구성. 라인 판정과 «기존 출고에도 적용» 미리보기가 같은 규칙을 쓴다. */
export function compositionFromMatching(matching: MatchingForFulfillment): MatchingComposition {
  if (isVoidMatching(matching)) return { kind: 'void' };
  const links = physicalSkuLinks(matching);
  if (links.length > 0) {
    // 링크 수량 0·누락을 1 로 읽는 것은 옛 FO 생성(`Math.max(1, link.quantity || 1)`)과 같은 규칙이다
    return {
      kind: 'follow',
      items: sortComposition(links.map((l) => ({ skuId: l.skuId, qtyPerUnit: Math.max(1, l.quantity || 1) }))),
    };
  }
  return { kind: 'missing', reason: matchingFailureReason(matching) };
}

export function sameComposition(a: readonly CompositionItem[], b: readonly CompositionItem[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortComposition(a);
  const right = sortComposition(b);
  return left.every((item, i) => item.skuId === right[i].skuId && item.qtyPerUnit === right[i].qtyPerUnit);
}

/** 운영자가 보낸 구성의 형식 문제. 없으면 null. DTO 검증이 못 잡는 «SKU 중복»까지 본다. */
export function compositionItemsProblem(items: readonly CompositionItem[]): string | null {
  if (items.length === 0) return 'composition is empty';
  if (new Set(items.map((item) => item.skuId)).size !== items.length) return 'composition has duplicate SKUs';
  if (items.some((item) => !Number.isSafeInteger(item.qtyPerUnit) || item.qtyPerUnit <= 0)) {
    return 'qtyPerUnit must be a positive integer';
  }
  return null;
}

export function resolveLineComposition(
  line: LineForComposition,
  frozen: readonly CompositionItem[],
  matching: MatchingForFulfillment,
): LineCompositionResolution {
  if (isDigitalFulfillmentLine(line)) return { kind: 'digital' };
  if (line.compositionSource !== null) {
    // 출처가 있는데 행이 없으면 쓰는 쪽(LineCompositionManager)의 결함이다 — 상품매칭으로 슬쩍 대신하면 결함이 숨는다
    if (frozen.length === 0) {
      throw new Error(
        `Line composition invariant violated: line ${line.id} has source ${line.compositionSource} but no rows`,
      );
    }
    return { kind: 'frozen', source: line.compositionSource, items: sortComposition(frozen) };
  }
  return compositionFromMatching(matching);
}

/** FO 생성을 막는 라인인가. 전량 취소된 라인은 미매칭이어도 막지 않는다 — FO 생성과 리컨실러가 이 함수 하나로 판정한다. */
export function blocksFulfillment(r: { fulfillableQuantity: number; resolution: LineCompositionResolution }): boolean {
  return r.fulfillableQuantity > 0 && r.resolution.kind === 'missing';
}
