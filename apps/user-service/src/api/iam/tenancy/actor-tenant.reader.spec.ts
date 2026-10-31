import { IamTenantUnresolvedError } from '../iam.errors';
import type { IamActor } from '../iam-actor';
import { ActorTenantReader } from './actor-tenant.reader';
import type { TenancyRepository } from './tenancy.repository';

describe('ActorTenantReader — 관리 API 요청자가 일하는 테넌트', () => {
  const actor = (tenantId?: string): IamActor => ({
    userId: 'u-1',
    loginId: 'admin',
    roles: ['master'],
    userAgent: null,
    requestId: null,
    ip: null,
    tenantId,
  });
  const reader = (memberships: string[]) =>
    new ActorTenantReader({ tenantsOf: () => Promise.resolve(memberships) } as unknown as TenancyRepository);

  it('토큰 테넌트가 있으면 그것이다 — 소속이 둘이어도', async () => {
    await expect(reader(['1', '2']).resolve(actor('2'))).resolves.toBe('2');
  });

  it('테넌트 없는 토큰(`tenant` 클레임 도입 전 발급)은 소속이 정확히 하나일 때만 그 소속', async () => {
    await expect(reader(['1']).resolve(actor())).resolves.toBe('1');
    await expect(reader(['1', '2']).resolve(actor())).rejects.toBeInstanceOf(IamTenantUnresolvedError);
  });
});
