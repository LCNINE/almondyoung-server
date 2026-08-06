import { assertDeletableShippingGroup, parseShippingGroupInput } from '../parse-shipping-group-input';

describe('parseShippingGroupInput', () => {
  const valid = {
    code: 'meal',
    name: '간편식 배송',
    policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 30000 },
    areaTemplateCode: 'default',
    delivery: { method: '택배', area: '전국지역', leadTimeMinDays: 2, leadTimeMaxDays: 3 },
  };

  it('정상 입력을 정규화한다', () => {
    expect(parseShippingGroupInput(valid)).toEqual({
      code: 'meal',
      name: '간편식 배송',
      policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 30000 },
      areaTemplateCode: 'default',
      delivery: { method: '택배', area: '전국지역', leadTimeMinDays: 2, leadTimeMaxDays: 3 },
    });
  });

  it('배송 안내가 없으면 기본값(택배·전국지역·2~3일)을 채운다', () => {
    const parsed = parseShippingGroupInput({ ...valid, delivery: undefined });
    expect(parsed.delivery).toEqual({
      method: '택배',
      area: '전국지역',
      leadTimeMinDays: 2,
      leadTimeMaxDays: 3,
    });
  });

  it('배송기간 시작일이 종료일보다 크면 거부한다', () => {
    expect(() =>
      parseShippingGroupInput({ ...valid, delivery: { leadTimeMinDays: 5, leadTimeMaxDays: 2 } })
    ).toThrow(/배송기간/);
  });

  // shipping option 의 data 갱신은 JSON 병합이라 빠뜨린 키가 옛 값으로 남는다.
  it('조건부 무료가 아니면 freeThreshold 를 0 으로 덮어쓴다', () => {
    const parsed = parseShippingGroupInput({ ...valid, policy: { type: 'flat', baseFee: 3500, freeThreshold: 30000 } });
    expect(parsed.policy.freeThreshold).toBe(0);
  });

  it('경로의 code 가 body 의 code 를 이긴다', () => {
    expect(parseShippingGroupInput({ ...valid, code: 'body-code' }, 'path-code').code).toBe('path-code');
  });

  it.each([
    ['대문자 code', { ...valid, code: 'Meal' }, /code/],
    ['공백 code', { ...valid, code: 'bad code' }, /code/],
    ['빈 이름', { ...valid, name: '  ' }, /name/],
    ['알 수 없는 유형', { ...valid, policy: { type: 'weight_tier', baseFee: 1 } }, /policy.type/],
    ['음수 금액', { ...valid, policy: { type: 'flat', baseFee: -1 } }, /baseFee/],
    ['소수점 금액', { ...valid, policy: { type: 'flat', baseFee: 1000.5 } }, /baseFee/],
    ['조건부 무료인데 기준금액 없음', { ...valid, policy: { type: 'conditional_free', baseFee: 3000 } }, /freeThreshold/],
    ['유료인데 배송비 0원', { ...valid, policy: { type: 'flat', baseFee: 0 } }, /baseFee/],
  ])('%s 은 거부한다', (_label, input, pattern) => {
    expect(() => parseShippingGroupInput(input)).toThrow(pattern as RegExp);
  });

  it('무료 그룹은 baseFee 0 을 허용한다', () => {
    expect(parseShippingGroupInput({ ...valid, policy: { type: 'free' } }).policy.baseFee).toBe(0);
  });
});

describe('assertDeletableShippingGroup', () => {
  it('기본 그룹 삭제를 막는다', () => {
    expect(() => assertDeletableShippingGroup('default')).toThrow(/기본 배송비 그룹/);
  });

  it('그 외 그룹은 통과시킨다', () => {
    expect(() => assertDeletableShippingGroup('meal')).not.toThrow();
  });
});
