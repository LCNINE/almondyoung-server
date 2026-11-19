import { readPendingCancellationLines } from './pending-cancellations';
import { readDeliveryNote } from './shipment-waybill.reader';

describe('readDeliveryNote', () => {
  it.each([
    ['메모가 있으면 다듬어 돌려준다', { deliveryNote: '  문 앞 ' }, '문 앞'],
    ['빈 문자열은 없음', { deliveryNote: '   ' }, null],
    ['null 은 없음', { deliveryNote: null }, null],
    ['키가 없으면 없음', { recipientName: '홍길동' }, null],
    ['문자열이 아니면 없음', { deliveryNote: 3 }, null],
    ['스냅샷이 객체가 아니면 없음', null, null],
  ])('%s', (_name, snapshot, expected) => {
    expect(readDeliveryNote(snapshot)).toBe(expected);
  });
});

describe('readPendingCancellationLines', () => {
  const line = (shipmentLineId: unknown, qty: unknown) => ({ shipmentLineId, expectedLineVersion: 1, qty });
  it.each([
    [
      '대기 중인 취소의 줄과 수량',
      { pendingIntent: { kind: 'cancel_outstanding', lines: [line('a', 1), line('b', 2)] } },
      [
        { shipmentLineId: 'a', qty: 1 },
        { shipmentLineId: 'b', qty: 2 },
      ],
    ],
    ['다른 종류의 의도는 없음', { pendingIntent: { kind: 'other', lines: [line('a', 1)] } }, null],
    ['줄 모양이 어긋나면 없음', { pendingIntent: { kind: 'cancel_outstanding', lines: [line('a', '1')] } }, null],
    ['줄이 비면 없음', { pendingIntent: { kind: 'cancel_outstanding', lines: [] } }, null],
    ['스냅샷이 없으면 없음', null, null],
  ])('%s', (_name, snapshot, expected) => {
    expect(readPendingCancellationLines(snapshot)).toEqual(expected);
  });
});
