import {
  resolveActiveChannelId,
  channelResolutionMessage,
} from './resolve-channel-id';
import type { ChannelDto } from '@/lib/types/dto/products';

const channel = (overrides: Partial<ChannelDto> = {}): ChannelDto => ({
  id: 'channel-uuid-1',
  type: 'MARKETPLACE',
  site: 'naver',
  name: '네이버 스마트스토어',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('resolveActiveChannelId', () => {
  it('code 가 없으면 해석할 것이 없다(일반 검색 플로우)', () => {
    expect(resolveActiveChannelId(undefined, [channel()], false)).toEqual({
      status: 'unresolved',
    });
  });

  it('채널 목록이 아직 로딩 중이면 loading', () => {
    expect(resolveActiveChannelId('naver', undefined, true)).toEqual({
      status: 'loading',
    });
  });

  it('site 가 일치하는 활성 채널을 찾으면 UUID 로 해석한다', () => {
    expect(
      resolveActiveChannelId('naver', [channel({ id: 'abc-123' })], false)
    ).toEqual({
      status: 'resolved',
      salesChannelId: 'abc-123',
    });
  });

  it('site 는 같지만 비활성이면 찾지 못한 것으로 취급한다', () => {
    expect(
      resolveActiveChannelId('naver', [channel({ isActive: false })], false)
    ).toEqual({ status: 'unresolved' });
  });

  it('일치하는 site 자체가 없으면 unresolved', () => {
    expect(
      resolveActiveChannelId('coupang', [channel({ site: 'naver' })], false)
    ).toEqual({
      status: 'unresolved',
    });
  });
});

describe('channelResolutionMessage', () => {
  it('code 가 없으면 아무 말도 하지 않는다', () => {
    expect(
      channelResolutionMessage({ status: 'unresolved' }, undefined)
    ).toBeNull();
  });

  it('해석되면 자동으로 채워졌다고 말한다', () => {
    const message = channelResolutionMessage(
      { status: 'resolved', salesChannelId: 'abc-123' },
      'naver'
    );
    expect(message).toContain('자동으로 채워졌습니다');
  });

  it('로딩 중이면 로딩 중이라고 말한다', () => {
    expect(channelResolutionMessage({ status: 'loading' }, 'naver')).toContain(
      '불러오는 중'
    );
  });

  it('찾지 못하면 비활성/미등록 가능성과 수동 입력 안내를 말한다 (channel_inactive 와 같은 결)', () => {
    const message = channelResolutionMessage({ status: 'unresolved' }, 'naver');
    expect(message).toContain('찾지 못했습니다');
    expect(message).toContain('직접');
  });
});
