import { SalesChannelMapper, SalesChannelWithCategory } from './sales-channel.mapper';

/**
 * `sales_channels.credentials` 는 런타임 소비자가 0곳인 죽은 컬럼인데, 어드민 응답에는
 * 그대로 실려 나갔다 (#650). 채널 인증의 정본은 SST Secret / env 다.
 * 이 스펙이 "응답에 시크릿 자리를 만들지 않는다"를 못 박는다.
 */
describe('SalesChannelMapper', () => {
  function entity(overrides: Partial<SalesChannelWithCategory> = {}): SalesChannelWithCategory {
    return {
      id: '019d0003-0001-7000-a000-000000000001',
      type: 'ONLINE',
      site: 'medusa',
      categoryId: null,
      category: null,
      name: '아몬드영 자사몰',
      description: null,
      config: null,
      isActive: true,
      apiEndpoint: null,
      // DB 에 남아 있는 컬럼이라 엔티티에는 여전히 존재한다 — 응답으로 새지 않는지가 관심사다
      credentials: { clientSecret: 'must-not-leak' },
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('응답에 credentials 를 싣지 않는다', () => {
    const dto = SalesChannelMapper.toDto(entity());

    expect(dto).not.toHaveProperty('credentials');
    expect(JSON.stringify(dto)).not.toContain('must-not-leak');
  });

  it('나머지 필드는 그대로 매핑한다', () => {
    const dto = SalesChannelMapper.toDto(entity());

    expect(dto.id).toBe('019d0003-0001-7000-a000-000000000001');
    expect(dto.site).toBe('medusa');
    expect(dto.type).toBe('ONLINE');
    expect(dto.isActive).toBe(true);
    expect(dto.config).toEqual({});
    expect(dto.createdAt).toBe('2026-08-17T00:00:00.000Z');
  });
});
