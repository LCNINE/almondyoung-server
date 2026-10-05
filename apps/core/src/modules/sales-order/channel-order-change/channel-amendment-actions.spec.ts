import { channelKeyOf } from './channel-amendment-actions.service';

describe('channelKeyOf', () => {
  it('채널 행 metadata 에서 채널 키를 읽는다', () => {
    expect(channelKeyOf({ salesChannel: 'medusa', externalOrderId: 'order_1' })).toEqual({
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
    });
  });

  it.each([[null], [{}], [{ salesChannel: 'medusa' }], [{ salesChannel: '', externalOrderId: 'o' }], [{ salesChannel: 'medusa', externalOrderId: 7 }]])(
    '키가 없거나 비면 명령을 내지 않고 실패한다 — %j',
    (metadata) => {
      expect(() => channelKeyOf(metadata)).toThrow('channel key');
    },
  );
});
