import type {
  MatchingStatus,
  MatchingStrategy,
} from '../../types/dto/matching';

export type MatchingStrategyDecision =
  | 'sku-composition'
  | 'stock-item-unmatched'
  | 'incomplete-sku-composition'
  | 'undecided'
  | 'legacy-audit';

type MatchingStrategyDecisionInput = {
  status?: MatchingStatus | null;
  strategy?: MatchingStrategy | null;
  matchedSkus?: unknown[] | null;
  links?: unknown[] | null;
  skuLinkCount?: number | null;
};

const getSkuLinkCount = ({
  links,
  matchedSkus,
  skuLinkCount,
}: MatchingStrategyDecisionInput) => {
  if (skuLinkCount != null) return skuLinkCount;
  return Math.max(matchedSkus?.length ?? 0, links?.length ?? 0);
};

export const getMatchingStrategyDecision = (
  input: MatchingStrategyDecisionInput
): MatchingStrategyDecision => {
  const { status, strategy } = input;

  if (status === 'matched' && strategy === 'variant') {
    return getSkuLinkCount(input) > 0
      ? 'sku-composition'
      : 'incomplete-sku-composition';
  }
  if (status === 'matched' && strategy === 'void')
    return 'stock-item-unmatched';
  if (status === 'ignored') return 'legacy-audit';
  return 'undecided';
};

export const isMatchingStrategyDecisionComplete = (
  input: MatchingStrategyDecisionInput
): boolean => {
  const decision = getMatchingStrategyDecision(input);
  return decision === 'sku-composition' || decision === 'stock-item-unmatched';
};

export const getMatchingStrategyDecisionLabel = (
  input: MatchingStrategyDecisionInput
): string => {
  const labels: Record<MatchingStrategyDecision, string> = {
    'sku-composition': 'SKU 구성 매칭',
    'stock-item-unmatched': '재고상품 비매칭',
    'incomplete-sku-composition': 'SKU 구성 매칭 불완전',
    undecided: '전략 미결정',
    'legacy-audit': '레거시 감사 대상',
  };

  return labels[getMatchingStrategyDecision(input)];
};

export const getMatchingStrategyDecisionColor = (
  input: MatchingStrategyDecisionInput
): string => {
  const colors: Record<MatchingStrategyDecision, string> = {
    'sku-composition': 'text-green-600 bg-green-100',
    'stock-item-unmatched': 'text-blue-600 bg-blue-100',
    'incomplete-sku-composition': 'text-orange-600 bg-orange-100',
    undecided: 'text-orange-600 bg-orange-100',
    'legacy-audit': 'text-neutral-600 bg-neutral-100',
  };

  return colors[getMatchingStrategyDecision(input)];
};
