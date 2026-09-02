import path from 'node:path';
import { CART_CONTEXT_ATTRIBUTES, CUSTOMER_SCOPED_ATTRIBUTES } from '../issuance-rules';

/**
 * 엔진이 어드민에 노출하는 ORDER 스코프 룰 속성을 **엔진 자신에게서** 읽는다.
 *
 * 깊은 내부 경로를 «일부러» 참조한다. Medusa 업그레이드가 여섯 번째 속성을 추가하면
 * 프로덕션에서 조용히 fail-closed 로 떨어지기 전에 여기가 먼저 빨개져야 하고, 경로가
 * 사라져도 마찬가지로 빨개져야 한다 — 그때 분류표를 다시 확인하는 것이 이 가드의 목적이다.
 */
function engineOrderScopeAttributes(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 엔진 내부 경로를 의도적으로 참조한다
  const pkgJsonPath = require.resolve('@medusajs/medusa/package.json');
  const mapPath = path.join(
    path.dirname(pkgJsonPath),
    'dist/api/admin/promotions/utils/rule-attributes-map.js',
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 위와 같은 이유
  const { getRuleAttributesMap } = require(mapPath) as {
    getRuleAttributesMap: (args: Record<string, string>) => { rules: { value: string }[] };
  };
  return getRuleAttributesMap({
    promotionType: 'standard',
    applicationMethodType: 'percentage',
    applicationMethodTargetType: 'order',
  }).rules.map((r) => r.value);
}

describe('발급 시점 분류표 ↔ 엔진 드리프트', () => {
  it('엔진의 ORDER 스코프 속성이 전부 분류표 안에 있다', () => {
    const known = new Set<string>([...CUSTOMER_SCOPED_ATTRIBUTES, ...CART_CONTEXT_ATTRIBUTES]);
    const unclassified = engineOrderScopeAttributes().filter((a) => !known.has(a));
    expect(unclassified).toEqual([]);
  });

  it('2026-09-01 실측 — 다섯이다', () => {
    expect(engineOrderScopeAttributes().sort()).toEqual(
      [
        'customer.groups.id',
        'region.id',
        'shipping_address.country_code',
        'sales_channel_id',
        'currency_code',
      ].sort(),
    );
  });
});
