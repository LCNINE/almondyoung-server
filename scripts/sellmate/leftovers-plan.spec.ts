import { classifyLeftover, LeftoverAction, LeftoverOrder } from './leftovers-plan';

const base: LeftoverOrder = {
  salesOrderId: 'so-1',
  channelOrderId: 'order_1',
  salesChannel: 'medusa',
  soStatus: 'shipped',
  foStatus: 'ready',
  openBacklogs: 1,
  openShipments: 1,
};

const none: LeftoverAction = { closeFo: false, closeShipments: false, closeBacklogs: false, report: null };

describe('classifyLeftover — 셀메이트로 나간 자사몰 주문만 닫는다', () => {
  it.each<[string, Partial<LeftoverOrder>, LeftoverAction]>([
    ['외부 출고 · FO 열림 → 전부 닫는다', {}, { closeFo: true, closeShipments: true, closeBacklogs: true, report: null }],
    ['delivered 도 외부 출고다', { soStatus: 'delivered' }, { closeFo: true, closeShipments: true, closeBacklogs: true, report: null }],
    ['FO 없이 대기열만', { foStatus: null, openShipments: 0 }, { ...none, closeBacklogs: true }],
    ['FO 는 이미 닫혔고 상자만 열림', { foStatus: 'shipped', openBacklogs: 0 }, { ...none, closeShipments: true }],
    ['FO processing → 사람이 본다', { foStatus: 'processing' }, { ...none, report: 'human-fo' }],
    ['FO partially_shipped → 사람이 본다', { foStatus: 'partially_shipped' }, { ...none, report: 'human-fo' }],
    ['FO recovery_required → 사람이 본다', { foStatus: 'recovery_required' }, { ...none, report: 'human-fo' }],
    ['마켓 주문은 2단계 몫', { salesChannel: 'naver' }, none],
    ['앱이 출고할 주문(confirmed)', { soStatus: 'confirmed' }, none],
    ['결제 대기 주문(pending)', { soStatus: 'pending' }, none],
    [
      '취소 주문 · FO·상자 열림 → 대기열만, 나머지는 보고',
      { soStatus: 'cancelled' },
      { ...none, closeBacklogs: true, report: 'cancelled-open' },
    ],
    [
      '취소 주문 · FO 취소됨 · 상자 없음 → 대기열만',
      { soStatus: 'cancelled', foStatus: 'canceled', openShipments: 0 },
      { ...none, closeBacklogs: true },
    ],
  ])('%s', (_name, override, expected) => {
    expect(classifyLeftover({ ...base, ...override })).toEqual(expected);
  });
});
