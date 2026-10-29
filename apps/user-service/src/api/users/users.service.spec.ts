import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
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
