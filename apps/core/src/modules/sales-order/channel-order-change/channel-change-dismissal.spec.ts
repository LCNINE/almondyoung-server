import { deltaFingerprint, suppressDismissed } from './channel-change-dismissal';
import type { RecordedChannelDelta } from './channel-order-change.types';

const ADD: RecordedChannelDelta = {
  type: 'add_product',
  channelOrderItemId: 'ci-9',
  channelProductId: 'cp-9',
  quantity: 1,
  unitPrice: 1000,
  outcome: 'pending',
  blockers: [{ code: 'OUT_OF_SCOPE' }],
};
const UP: RecordedChannelDelta = {
  type: 'quantity_correction',
  salesOrderLineId: 'sol-1',
  channelOrderItemId: 'ci-1',
  quantityBefore: 1,
  correctedQuantity: 3,
  outcome: 'pending',
  blockers: [{ code: 'OUT_OF_SCOPE' }],
};
const ADDRESS_APPLIED: RecordedChannelDelta = {
  type: 'shipping_address_change',
  before: { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' },
  after: { recipientName: '김', phone: '010', postalCode: '2', roadAddress: '부산', detailAddress: '2' },
  outcome: 'applied',
};

describe('deltaFingerprint', () => {
  it('막힌 사유·결과는 지문 밖이다 — 무시는 «이 차이»를 받아들인 것', () => {
    const later = { ...ADD, blockers: [{ code: 'WAYBILL_ISSUED', shipmentId: 'sh-1' }] };
    expect(deltaFingerprint(later)).toBe(deltaFingerprint(ADD));
    const { outcome: _o, blockers: _b, ...bare } = ADD;
    expect(deltaFingerprint(bare)).toBe(deltaFingerprint(ADD));
  });

  it('값이 다르면 지문이 다르다', () => {
    expect(deltaFingerprint({ ...ADD, quantity: 2 })).not.toBe(deltaFingerprint(ADD));
  });

  it('중첩 객체의 키 순서가 달라도(jsonb 왕복) 같은 지문', () => {
    const reordered = {
      outcome: 'pending',
      after: { detailAddress: '2', roadAddress: '부산', postalCode: '2', phone: '010', recipientName: '김' },
      type: 'shipping_address_change',
      before: { detailAddress: '1', roadAddress: '서울', postalCode: '1', phone: '010', recipientName: '김' },
      blockers: [{ code: 'WAYBILL_ISSUED' }],
    };
    expect(deltaFingerprint(reordered)).toBe(deltaFingerprint(ADDRESS_APPLIED));
  });
});

describe('suppressDismissed', () => {
  const dismissedJson = (deltas: RecordedChannelDelta[]): unknown[] => JSON.parse(JSON.stringify(deltas));

  it('무시 행이 없으면 그대로', () => {
    expect(suppressDismissed([ADD], null)).toEqual([ADD]);
  });

  it('이번 pending 이 전부 무시된 것이면 pending 을 뺀다', () => {
    expect(suppressDismissed([ADD], dismissedJson([ADD]))).toEqual([]);
  });

  it('반영된 델타는 억제 대상이 아니다 — 남는다', () => {
    expect(suppressDismissed([ADDRESS_APPLIED, ADD], dismissedJson([ADD]))).toEqual([ADDRESS_APPLIED]);
  });

  it('새 pending 이 하나라도 있으면 아무것도 빼지 않는다', () => {
    expect(suppressDismissed([ADD, UP], dismissedJson([ADD]))).toEqual([ADD, UP]);
  });

  it('무시 행의 applied 델타는 무시 기준이 아니다', () => {
    const appliedAdd = { ...ADD, outcome: 'applied' };
    expect(suppressDismissed([ADD], [appliedAdd])).toEqual([ADD]);
  });

  it('무시 행의 jsonb 에 객체가 아닌 원소가 섞여도 죽지 않는다', () => {
    expect(suppressDismissed([ADD], [null, 'x', ...dismissedJson([ADD])])).toEqual([]);
  });
});
