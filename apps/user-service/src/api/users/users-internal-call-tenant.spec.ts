import { parseTenantList, TenancyConfig } from '@app/tenancy';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { WithdrawnReplayService } from './withdrawn-replay.service';

const tenancy = new TenancyConfig(
  parseTenantList(
    JSON.stringify([
      { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
      { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two-pub', privateBucket: 'bucket-two-priv' },
    ]),
  ),
  'reject',
);
const from = (tenant?: string) => ({ headers: tenant === undefined ? {} : { 'x-tenant-id': tenant } });

/**
 * 전화번호·발송 대상으로 계정을 찾는 내부 라우트는 호출 테넌트로 거르고, 테넌트 없는 호출은 조회 전에 거절한다(ADR-0056).
 * 테넌트별 필터 자체는 실 DB 스펙(`recovery-and-contacts-within-tenant.integration.spec.ts`)이 본다.
 */
describe('UsersController — 내부 조회는 호출 테넌트 안', () => {
  let users: Record<string, jest.Mock>;
  let controller: UsersController;

  beforeEach(() => {
    users = {
      findActiveContactsByPhone: jest.fn().mockResolvedValue([]),
      findSmsAudience: jest.fn().mockResolvedValue([]),
      summarizeSmsAudience: jest.fn().mockResolvedValue({ active: 0, withPhone: 0, consented: 0 }),
      withdrawMarketingConsentByPhone: jest.fn().mockResolvedValue({ userIds: [], withdrawnUserIds: [] }),
      findUserByEmailInTenant: jest.fn().mockResolvedValue(null),
    };
    controller = new UsersController(
      users as unknown as UsersService,
      {} as WithdrawnReplayService,
      '1',
      tenancy,
    );
  });

  /** 네 라우트를 같은 요청으로 부른다. */
  const callAll = (request: unknown): (() => Promise<unknown>)[] => [
    () => controller.getInternalContactsByPhone(request, { phoneNumber: '01012345678' }),
    () => controller.getSmsAudience(request, 'true'),
    () => controller.getSmsAudienceSummary(request),
    () => controller.withdrawMarketingConsent(request, { phoneNumber: '01012345678', via: 'sms-reply' }),
  ];

  it('호출자가 실은 테넌트로 찾는다', async () => {
    for (const call of callAll(from('2'))) await call();

    expect(users.findActiveContactsByPhone).toHaveBeenCalledWith('2', '01012345678');
    expect(users.findSmsAudience).toHaveBeenCalledWith('2', true);
    expect(users.summarizeSmsAudience).toHaveBeenCalledWith('2');
    expect(users.withdrawMarketingConsentByPhone).toHaveBeenCalledWith('2', '01012345678', 'sms-reply');
  });

  it('테넌트 없는 호출·목록 밖 테넌트는 찾기 전에 403', async () => {
    for (const request of [from(), from('9')]) {
      for (const call of callAll(request)) {
        await expect(Promise.resolve().then(call)).rejects.toMatchObject({ status: 403 });
      }
    }
    for (const lookup of Object.values(users)) expect(lookup).not.toHaveBeenCalled();
  });

  it('관리자 이메일 고객 조회는 이 앱이 섬기는 테넌트의 계정만 찾는다', async () => {
    await controller.findUserByEmail('member@example.com');
    expect(users.findUserByEmailInTenant).toHaveBeenCalledWith('1', 'member@example.com');
  });
});
