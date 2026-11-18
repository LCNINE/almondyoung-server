import { labelOrderNoOf } from './waybill.reader';

describe('labelOrderNoOf', () => {
  const orderDate = new Date('2026-11-18T03:00:00Z');

  it('화면 주문번호가 있으면 주문일-화면 주문번호', () => {
    expect(labelOrderNoOf({ displayOrderNo: '7148', orderDate, channelOrderId: 'x' })).toBe('20261118-7148');
  });

  it('화면 주문번호가 없는 수기·위탁 주문은 채널 주문번호', () => {
    expect(labelOrderNoOf({ displayOrderNo: null, orderDate, channelOrderId: 'SO-20261118-BWZJAH' })).toBe(
      'SO-20261118-BWZJAH',
    );
  });

  it('둘 다 없으면 null', () => {
    expect(labelOrderNoOf({ displayOrderNo: null, orderDate: null, channelOrderId: null })).toBeNull();
  });
});
