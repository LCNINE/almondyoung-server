import { readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * 함께 구매 재판정은 refreshCartItemsWorkflow 의 setPricingContext 훅이 «카트 다시 읽기·프로모션 갱신 앞»에서
 * cart_id 를 받는다는 데 기대고 있다. Medusa 업그레이드로 이 순서가 바뀌면 쿠폰이 옛 단가로 계산된다.
 */
describe('refreshCartItemsWorkflow hook placement', () => {
  // 패키지 exports 가 깊은 경로를 막으므로 진입점(dist/index.js) 옆에서 찾는다.
  const source = readFileSync(join(dirname(require.resolve('@medusajs/core-flows')), 'cart/workflows/refresh-cart-items.js'), 'utf8');

  it('creates setPricingContext with cart_id before refetching the cart and refreshing promotions', () => {
    const hook = source.indexOf('createHook)("setPricingContext"');
    const refetch = source.indexOf('name: "refetch-cart"');
    const promotions = source.indexOf('updateCartPromotionsWorkflow.runAsStep');
    expect(hook).toBeGreaterThan(-1);
    expect(source.slice(hook, hook + 200)).toContain('cart_id: input.cart_id');
    expect(refetch).toBeGreaterThan(hook);
    expect(promotions).toBeGreaterThan(refetch);
  });
});
