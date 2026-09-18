import { diffFields } from './product-audit-log';

it('diffFields 는 after 에 정의된 키 중 바뀐 것만 { old, new } 로 모은다', () => {
  expect(
    diffFields(
      { isOverseas: false, shippingGroupCode: 'meal', name: 'A' },
      { isOverseas: true, shippingGroupCode: 'meal', brand: 'B', seller: undefined },
    ),
  ).toEqual({
    isOverseas: { old: false, new: true },
    brand: { old: null, new: 'B' },
  });
});
