import { CHANNEL_CAPABILITIES } from '../../../../../channel-adapter/src/services/channel-capabilities';
import { CHANNEL_CANCELLATION_CAPABILITIES, SalesChannelName } from './channel-cancellation-capability';

// N6 — core 쪽 사본이 channel-adapter 의 능력 벡터와 갈리면 여기서 빨개진다.
describe('channel-cancellation-capability ↔ channel-adapter CHANNEL_CAPABILITIES', () => {
  it('채널 집합이 같다', () =>
    expect(Object.keys(CHANNEL_CANCELLATION_CAPABILITIES).sort()).toEqual(Object.keys(CHANNEL_CAPABILITIES).sort()));

  it.each(Object.keys(CHANNEL_CAPABILITIES))(
    '%s — «명령으로 취소»가 channel-adapter 의 automatedCancellation 과 같다',
    (ch) =>
      expect(CHANNEL_CANCELLATION_CAPABILITIES[ch as SalesChannelName].cancel === 'command').toBe(
        CHANNEL_CAPABILITIES[ch as keyof typeof CHANNEL_CAPABILITIES].fulfillment.automatedCancellation,
      ),
  );
});
