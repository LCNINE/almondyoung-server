import { defineLink } from '@medusajs/framework/utils';
import PricingModule from '@medusajs/medusa/pricing';
import TimeSaleModule from '../modules/time-sale';

// 세일 하나 ↔ price list 1~2개(일반용·멤버십용). 일반/멤버십 구분은 리스트의 customer.groups.id 규칙으로 한다
// — 같은 사실을 링크 컬럼에 또 적으면 둘이 갈릴 수 있다.
export default defineLink(TimeSaleModule.linkable.timeSale, {
  linkable: PricingModule.linkable.priceList,
  isList: true,
});
