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
  const reader = (accountTenant: string | null) =>
    new ActorTenantReader({ accountTenantOf: () => Promise.resolve(accountTenant) } as unknown as TenancyRepository);

  it('토큰 테넌트가 있으면 그것이다', async () => {
    await expect(reader('1').resolve(actor('2'))).resolves.toBe('2');
  });

  it('테넌트 없는 토큰(`tenant` 클레임 도입 전 발급)은 요청자 계정의 테넌트 — 계정은 한 테넌트의 것이다', async () => {
    await expect(reader('7').resolve(actor())).resolves.toBe('7');
    await expect(reader(null).resolve(actor())).rejects.toBeInstanceOf(IamTenantUnresolvedError);
  });
});
