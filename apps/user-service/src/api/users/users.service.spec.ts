import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { TENANT_CONTEXT_KEY } from '@app/tenancy';
import { ClsServiceManager } from 'nestjs-cls';
import { UsersService } from './users.service';

const USER_ID = '00000000-0000-4000-8000-00000000000a';

function createService(roleRows: Array<{ role: { id: string; name: string } }>) {
  const limit = jest.fn().mockResolvedValue([{ id: USER_ID }]);
  const select = jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  const reader = { findLiveRoles: jest.fn().mockResolvedValue(roleRows) };
  const service = new UsersService({ db: { select } } as never, {} as never, reader as never);
  return { service, reader, limit };
}

describe('UsersService.getUserRoles', () => {
  it('returns the reader roles under the user id, without scopes', async () => {
    const rows = [{ role: { id: 'r1', name: 'staff' } }];
    const { service, reader } = createService(rows);

    await expect(service.getUserRoles(USER_ID)).resolves.toEqual({ userId: USER_ID, roles: rows });
    expect(reader.findLiveRoles).toHaveBeenCalledWith(USER_ID);
  });

  it('does not read roles for an unknown user', async () => {
    const { service, reader, limit } = createService([]);
    limit.mockResolvedValue([]);

    await expect(service.getUserRoles(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(reader.findLiveRoles).not.toHaveBeenCalled();
  });

  it('hides the raw cause of a reader failure behind the generic message', async () => {
    const { service, reader } = createService([]);
    reader.findLiveRoles.mockRejectedValue(new Error('connection refused to db-host'));

    const failure = await service.getUserRoles(USER_ID).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(InternalServerErrorException);
    expect(failure).toHaveProperty('message', '사용자 권한 정보를 불러오는 중 오류가 발생했습니다.');
  });
});

describe('UsersService.updateMyProfile — UserUpdated 의 테넌트', () => {
  // 봉투의 테넌트는 발행 순간의 맥락이다. 프로필 수정은 계정의 테넌트 일이다(ADR-0056) — 요청 화면의 테넌트가 아니다.
  it('계정의 테넌트로 낸다 — 요청 맥락이 다른 테넌트여도', async () => {
    const seen: (string | undefined)[] = [];
    const cls = ClsServiceManager.getClsService();
    const publisher = {
      publishEvent: jest.fn(() => {
        seen.push(cls.get<string>(TENANT_CONTEXT_KEY));
        return Promise.resolve();
      }),
    };
    const db = {
      select: jest.fn(() => ({
        from: () => ({ where: () => ({ limit: jest.fn().mockResolvedValue([{ tenantId: '2', nickname: 'old' }]) }) }),
      })),
      update: jest.fn(() => ({ set: () => ({ where: jest.fn().mockResolvedValue(undefined) }) })),
    };
    const service = new UsersService({ db } as never, publisher as never, {} as never);

    await cls.run(async () => {
      cls.set(TENANT_CONTEXT_KEY, '1');
      await service.updateMyProfile(USER_ID, { username: '새이름' });
    });

    expect(publisher.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'UserUpdated' }));
    expect(seen).toEqual(['2']);
  });
});
