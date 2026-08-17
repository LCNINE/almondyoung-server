import { SALES_CHANNELS } from '@packages/event-contracts/streams/orders.stream';
import {
  SALES_CHANNEL_SITE_LABELS,
  SALES_CHANNEL_SITE_OPTIONS,
  CHANNEL_TYPE_OPTIONS,
  siteLabel,
} from './vocabulary';

/**
 * 판매채널 드롭다운의 값은 `sales_channels.site` 로 그대로 전송된다. 그 어휘의 정본은
 * 서버의 `SALES_CHANNELS` 하나다 (ADR-0031 결정 7).
 *
 * 예전에는 프런트가 `naver_smartstore` / `phone_order` / `other` 라는 별도 목록을 들고 있었고,
 * 서버가 어휘를 좁혔을 때 아무도 눈치채지 못했다 (#649 결함 1). 이 스펙이 그 드리프트를 잡는다.
 */
describe('판매채널 site 어휘', () => {
  it('서버 어휘 SALES_CHANNELS 와 정확히 같은 키를 갖는다', () => {
    const frontKeys = Object.keys(SALES_CHANNEL_SITE_LABELS).sort();
    const serverKeys = [...SALES_CHANNELS].sort();

    expect(frontKeys).toEqual(serverKeys);
  });

  it('옵션 목록이 라벨 맵에서 파생된다', () => {
    expect(SALES_CHANNEL_SITE_OPTIONS.map((o) => o.value).sort()).toEqual(
      Object.keys(SALES_CHANNEL_SITE_LABELS).sort(),
    );
    for (const option of SALES_CHANNEL_SITE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it('모르는 값은 그대로 보여준다', () => {
    expect(siteLabel('naver')).toBe('네이버 스마트스토어');
    expect(siteLabel('unknown_site')).toBe('unknown_site');
  });

  // `type` 축은 site 축과 달리 자동 가드가 없다 — 서버가 이 어휘를 세 DTO 파일에
  // `@IsEnum(['ONLINE', 'OFFLINE', 'MARKETPLACE', 'MOBILE_APP', 'SOCIAL_COMMERCE'])` 리터럴로만
  // 갖고 있고 (create-sales-channel.dto.ts:13, update-sales-channel.dto.ts:12,
  // sales-channel-response.dto.ts:11), import 할 공유 정본이 없기 때문이다. 아래는 그저
  // 이 프런트 목록을 손으로 고정한 스냅샷이다 — 실수로 로컬에서 값이 바뀌는 것만 잡는다.
  // 서버 쪽 목록이 바뀌면 이 파일도 사람이 손으로 맞춰야 한다.
  it('채널 형태 어휘가 이 목록에서 벗어나지 않는다', () => {
    expect(CHANNEL_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'ONLINE',
      'OFFLINE',
      'MARKETPLACE',
      'MOBILE_APP',
      'SOCIAL_COMMERCE',
    ]);
  });
});
