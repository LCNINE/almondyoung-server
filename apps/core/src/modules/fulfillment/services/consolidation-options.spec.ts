import { classifyConsolidationOption, consolidationCustomerKey } from './consolidation-options';

const base = {
  recipientName: '김알몬',
  phone: '010-1234-5678',
  postalCode: '14500',
  roadAddress: '경기 부천시 원미로 12',
  detailAddress: '101호',
};
const classify = (optionRecipient: unknown, optionCustomerKey: string | null = 'id:c1') =>
  classifyConsolidationOption({
    sourceRecipient: base,
    sourceCustomerKey: 'id:c1',
    optionRecipient,
    optionCustomerKey,
  });

describe('classifyConsolidationOption', () => {
  it('같은 수령인이면 ok', () => expect(classify({ ...base })).toEqual({ reason: 'ok', selectable: true }));
  it('전화 표기만 달라도 ok', () => expect(classify({ ...base, phone: '01012345678' }).reason).toBe('ok'));
  it('메모만 다르면 memo_differs, 고를 수 있다', () =>
    expect(classify({ ...base, deliveryNote: '문 앞에 놔 주세요' })).toEqual({
      reason: 'memo_differs',
      selectable: true,
    }));
  it('주소가 다르면 address_differs', () =>
    expect(classify({ ...base, roadAddress: '서울 마포구 양화로 45' })).toEqual({
      reason: 'address_differs',
      selectable: false,
    }));
  it('이름이 다르면 address_differs', () =>
    expect(classify({ ...base, recipientName: '박알몬' }).reason).toBe('address_differs'));
  it('수령인이 불완전하면 incomplete_recipient', () =>
    expect(classify({ ...base, detailAddress: '' }).reason).toBe('incomplete_recipient'));
  it('고객을 모르면 unknown_customer', () => expect(classify(base, null).reason).toBe('unknown_customer'));
});

describe('consolidationCustomerKey', () => {
  const line = (
    salesOrderId: string | null,
    customer: Partial<Record<'customerId' | 'customerName' | 'customerPhone', string>>,
  ) => ({
    salesOrderId,
    customerId: customer.customerId ?? null,
    customerName: customer.customerName ?? null,
    customerPhone: customer.customerPhone ?? null,
  });

  it('customerId 가 하나면 그것으로 맺는다', () =>
    expect(consolidationCustomerKey([line('o1', { customerId: 'c1' }), line('o2', { customerId: 'c1' })])).toBe(
      'id:c1',
    ));
  it('customerId 가 섞이면 모른다', () =>
    expect(consolidationCustomerKey([line('o1', { customerId: 'c1' }), line('o2', {})])).toBeNull());
  it('customerId 가 없으면 이름과 전화 숫자로 맺는다', () =>
    expect(
      consolidationCustomerKey([
        line('o1', { customerName: ' 김알몬 ', customerPhone: '010-1234-5678' }),
        line('o2', { customerName: '김알몬', customerPhone: '01012345678' }),
      ]),
    ).toBe('contact:김알몬:01012345678'));
  it('전화가 없으면 모른다', () =>
    expect(consolidationCustomerKey([line('o1', { customerName: '김알몬' })])).toBeNull());
  it('판매주문 없는 라인이 있으면 모른다', () =>
    expect(consolidationCustomerKey([line('o1', { customerId: 'c1' }), line(null, {})])).toBeNull());
});
