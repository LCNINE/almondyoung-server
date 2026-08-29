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
      // carrier·description 은 입력이 없어도 빈 문자열로 항상 채운다. data 갱신이 JSON 병합이라
      // 키를 빠뜨리면 옛 값이 남아 '지우기' 가 동작하지 않는다.
      delivery: { method: '택배', area: '전국지역', leadTimeMinDays: 2, leadTimeMaxDays: 3, carrier: '' },
      description: '',
    });
  });

  it('배송 안내가 없으면 기본값(택배·전국지역·2~3일)을 채운다', () => {
    const parsed = parseShippingGroupInput({ ...valid, delivery: undefined });
    expect(parsed.delivery).toEqual({
      method: '택배',
      area: '전국지역',
      leadTimeMinDays: 2,
      leadTimeMaxDays: 3,
      carrier: '',
    });
  });

  it('택배사와 안내 문구는 앞뒤 공백을 떼고 담는다', () => {
    const parsed = parseShippingGroupInput({
      ...valid,
      delivery: { ...valid.delivery, carrier: '  한진택배  ' },
      description: '  주문 후 2~3일 내 발송합니다.  ',
    });
    expect(parsed.delivery.carrier).toBe('한진택배');
    expect(parsed.description).toBe('주문 후 2~3일 내 발송합니다.');
  });

  // 비운 값도 키를 남겨야 JSON 병합에서 옛 값이 되살아나지 않는다.
  it.each<[string, unknown]>([
    ['빈 문자열', ''],
    ['null', null],
    ['생략', undefined],
  ])('안내 문구가 %s 이면 빈 문자열로 지운다', (_label, description) => {
    expect(parseShippingGroupInput({ ...valid, description })).toHaveProperty('description', '');
  });

  it('공백뿐인 택배사는 빈 문자열로 지운다', () => {
    const parsed = parseShippingGroupInput({ ...valid, delivery: { ...valid.delivery, carrier: '   ' } });
    expect(parsed.delivery).toHaveProperty('carrier', '');
  });

  it('안내 문구는 500자까지 허용한다', () => {
    const description = '가'.repeat(500);
    expect(parseShippingGroupInput({ ...valid, description }).description).toBe(description);
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
    ['500자를 넘는 안내 문구', { ...valid, description: '가'.repeat(501) }, /description/],
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
