import { MAX_BUNDLE_OFFERS_PER_PRODUCT } from '@packages/event-contracts/streams/product.stream';
import { discountedPrice, isCalendarDate, VariantPriceBasis } from './quantity-discount.math';

export const MAX_BUNDLE_OFFERS = MAX_BUNDLE_OFFERS_PER_PRODUCT;
export const MAX_BUNDLE_OFFER_LABEL_LENGTH = 40;
const BP_PER_PERCENT = 100;
const MAX_RATE_BP = 99 * BP_PER_PERCENT;

export interface BundleOfferInput {
  addonMasterId: string;
  /** null 이면 구성품의 모든 옵션 */
  allowedVariantIds: string[] | null;
  regularRateBp: number;
  membershipRateBp: number;
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  label: string | null;
}

/** 구성품으로 팔 수 없는 이유. 함께 담기는 일반 담기 검사를 그대로 지나므로, 거기서 막히거나 따로 다뤄야 하는 상품은 처음부터 받지 않는다. */
export type AddonNotSellableReason = 'inactive' | 'digital' | 'members_only' | 'purchase_constraint';

export interface AddonFacts {
  masterId: string;
  name: string;
  notSellableReason: AddonNotSellableReason | null;
  variants: VariantPriceBasis[];
}

export type BundleOfferViolationCode =
  | 'TOO_MANY_OFFERS'
  | 'SELF_ADDON'
  | 'DUPLICATE_ADDON'
  | 'ADDON_NOT_FOUND'
  | 'ADDON_NOT_SELLABLE'
  | 'VARIANT_NOT_IN_ADDON'
  | 'RATE_OUT_OF_RANGE'
  | 'RATE_BOTH_ZERO'
  | 'MEMBER_PRICE_ABOVE_REGULAR'
  | 'PERIOD_INVALID_DATE'
  | 'PERIOD_REVERSED'
  | 'LABEL_TOO_LONG';

export interface BundleOfferViolation {
  code: BundleOfferViolationCode;
  offerIndex?: number;
  reason?: AddonNotSellableReason;
  variantId?: string;
  regularPrice?: number;
  membershipPrice?: number;
}

const validRate = (bp: number) => Number.isInteger(bp) && bp >= 0 && bp <= MAX_RATE_BP && bp % BP_PER_PERCENT === 0;

export function validateBundleOffers(
  masterId: string,
  offers: BundleOfferInput[],
  addons: Map<string, AddonFacts>,
): BundleOfferViolation[] {
  const violations: BundleOfferViolation[] = [];
  if (offers.length > MAX_BUNDLE_OFFERS) violations.push({ code: 'TOO_MANY_OFFERS' });

  const seen = new Set<string>();
  offers.forEach((offer, offerIndex) => {
    const push = (v: Omit<BundleOfferViolation, 'offerIndex'>) => violations.push({ ...v, offerIndex });

    if (offer.addonMasterId === masterId) {
      push({ code: 'SELF_ADDON' });
      return;
    }
    if (seen.has(offer.addonMasterId)) {
      push({ code: 'DUPLICATE_ADDON' });
      return;
    }
    seen.add(offer.addonMasterId);

    const facts = addons.get(offer.addonMasterId);
    if (!facts) {
      push({ code: 'ADDON_NOT_FOUND' });
      return;
    }
    if (facts.notSellableReason) {
      push({ code: 'ADDON_NOT_SELLABLE', reason: facts.notSellableReason });
      return;
    }

    const known = new Set(facts.variants.map((v) => v.variantId));
    const unknown = (offer.allowedVariantIds ?? []).find((id) => !known.has(id));
    if (unknown) push({ code: 'VARIANT_NOT_IN_ADDON', variantId: unknown });

    if (!validRate(offer.regularRateBp) || !validRate(offer.membershipRateBp)) {
      push({ code: 'RATE_OUT_OF_RANGE' });
    } else if (offer.regularRateBp === 0 && offer.membershipRateBp === 0) {
      push({ code: 'RATE_BOTH_ZERO' });
    } else {
      const allowed = offer.allowedVariantIds ? new Set(offer.allowedVariantIds) : null;
      for (const v of facts.variants) {
        if (allowed && !allowed.has(v.variantId)) continue;
        const regularPrice = discountedPrice(v.basePrice, offer.regularRateBp);
        const membershipPrice = discountedPrice(v.membershipPrice, offer.membershipRateBp);
        if (membershipPrice > regularPrice) {
          push({ code: 'MEMBER_PRICE_ABOVE_REGULAR', variantId: v.variantId, regularPrice, membershipPrice });
        }
      }
    }

    if ([offer.startsOn, offer.endsOn].some((day) => day !== null && !isCalendarDate(day))) {
      push({ code: 'PERIOD_INVALID_DATE' });
    } else if (offer.startsOn && offer.endsOn && offer.startsOn > offer.endsOn) {
      push({ code: 'PERIOD_REVERSED' });
    }

    if (offer.label !== null && offer.label.length > MAX_BUNDLE_OFFER_LABEL_LENGTH) push({ code: 'LABEL_TOO_LONG' });
  });

  return violations;
}

const won = (n: number | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

const NOT_SELLABLE_TEXT: Record<AddonNotSellableReason, string> = {
  inactive: '판매 중인 상품이 아닙니다',
  digital: '디지털 상품은 구성품으로 둘 수 없습니다',
  members_only: '회원에게만 보이는 상품은 구성품으로 둘 수 없습니다',
  purchase_constraint: '구매 제한(멤버십 필수·평생 구매 수량)이 있는 상품은 구성품으로 둘 수 없습니다',
};

function violationSentence(v: BundleOfferViolation): string {
  switch (v.code) {
    case 'TOO_MANY_OFFERS':
      return `구성품은 최대 ${MAX_BUNDLE_OFFERS}개까지 넣을 수 있습니다.`;
    case 'SELF_ADDON':
      return '자기 자신은 구성품으로 넣을 수 없습니다.';
    case 'DUPLICATE_ADDON':
      return '같은 구성품이 두 번 있습니다.';
    case 'ADDON_NOT_FOUND':
      return '찾을 수 없는 상품입니다.';
    case 'ADDON_NOT_SELLABLE':
      return `${NOT_SELLABLE_TEXT[v.reason ?? 'inactive']}.`;
    case 'VARIANT_NOT_IN_ADDON':
      return '이 상품에 없는 옵션이 대상에 들어 있습니다.';
    case 'RATE_OUT_OF_RANGE':
      return '할인율은 0~99 사이 정수 %로 넣어 주세요.';
    case 'RATE_BOTH_ZERO':
      return '일반·멤버십 중 하나는 할인율이 있어야 합니다.';
    case 'MEMBER_PRICE_ABOVE_REGULAR':
      return `멤버십 회원가 ${won(v.membershipPrice)}이 일반가 ${won(v.regularPrice)}보다 비쌉니다. 멤버십 %를 올리거나 대상 옵션을 확인해 주세요.`;
    case 'PERIOD_INVALID_DATE':
      return '달력에 없는 날짜입니다.';
    case 'PERIOD_REVERSED':
      return '시작일이 종료일보다 늦습니다.';
    case 'LABEL_TOO_LONG':
      return `안내 문구는 ${MAX_BUNDLE_OFFER_LABEL_LENGTH}자까지 넣을 수 있습니다.`;
  }
}

export function describeBundleOfferViolation(
  v: BundleOfferViolation,
  offers: BundleOfferInput[],
  addons: Map<string, AddonFacts>,
): string {
  const offer = v.offerIndex === undefined ? undefined : offers[v.offerIndex];
  const name = offer ? addons.get(offer.addonMasterId)?.name : undefined;
  return (name ? `${name}: ` : '') + violationSentence(v);
}

/** 관리자 화면에 그대로 보여 줄 한 문장. 첫 이유를 쓰고 나머지는 건수로 붙인다. */
export function bundleOfferErrorMessage(
  violations: BundleOfferViolation[],
  offers: BundleOfferInput[],
  addons: Map<string, AddonFacts>,
): string {
  const [first, ...rest] = violations;
  const head = `함께 구매 구성품을 저장하지 못했습니다: ${describeBundleOfferViolation(first, offers, addons)}`;
  return rest.length > 0 ? `${head} (외 ${rest.length}건)` : head;
}
