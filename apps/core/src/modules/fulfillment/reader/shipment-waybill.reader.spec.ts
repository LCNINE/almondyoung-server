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
