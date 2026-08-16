import { SALES_CHANNELS } from '@packages/event-contracts/streams';
import { PIM_SALES_CHANNEL_SEEDS } from './pim.seed-step';

/**
 * 시드가 넣는 `site` 값이 어휘 밖이면 **아무 것도 깨지지 않은 채로** 채널 리스팅 조회만 조용히
 * 0행을 낸다 (`eq(salesChannels.site, channelCode)` 는 대소문자를 그대로 비교한다). 실제로
 * 그 상태로 오래 있었다 — 시드는 `'MEDUSA'`, 조회는 `'medusa'` 였다.
 *
 * 시드는 DTO 검증을 통과하지 않고 DB 에 직접 INSERT 하므로, 어휘를 지키는 자리가 여기밖에 없다.
 */
describe('PIM 시드 판매채널', () => {
  it.each(PIM_SALES_CHANNEL_SEEDS)('$name 의 site 가 SalesChannel 어휘에 있다', ({ site }) => {
    expect(SALES_CHANNELS).toContain(site);
  });
});
