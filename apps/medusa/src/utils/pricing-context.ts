/**
 * 표준 /store/products 는 코어의 setPricingContext 미들웨어가 region_id + customer.groups 를
 * 채워준다. 커스텀 라우트에는 그 미들웨어가 안 붙으므로 같은 모양을 직접 만든다.
 *
 * 컨텍스트가 { currency_code } 뿐이면 pricing 모듈은 rule 매칭 자체를 건너뛰고
 * (PricingRepository.calculatePrices 의 hasComplexContext=false 분기)
 * "price.rules_count = 0" 만으로 price list 가격을 후보에 넣는다 — 멤버십 price list 가
 * 비회원에게도 적용돼 표시가가 결제가와 어긋난다. currency_code 는 매칭 전에 제거되므로
 * region_id 처럼 «항상 있는» 값이 하나는 남아야 한다.
 */
export const buildPricingContext = ({
  currencyCode,
  regionId,
  customerGroupIds,
}: {
  currencyCode: string;
  regionId?: string;
  customerGroupIds: string[];
}): Record<string, unknown> => {
  const context: Record<string, unknown> = { currency_code: currencyCode };

  if (regionId) {
    context.region_id = regionId;
  }

  if (customerGroupIds.length > 0) {
    context.customer = { groups: customerGroupIds.map((id) => ({ id })) };
  }

  return context;
};
