import { BadRequestError, ServiceUnavailableError } from '@app/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { UsersService } from './users.service';

/** 쿼리 빌더 흉내 — 어떤 체인이든 await 하면 쌓아 둔 결과를 차례로 돌려준다. */
function fakeClient(results: unknown[]) {
  let calls = 0;
  const chain: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') {
        const next = results[calls++];
        return (resolve: (v: unknown) => unknown) => resolve(next);
      }
      return chain;
    },
    apply: () => chain,
  });
  return { client: chain as never, calls: () => calls };
}

const userRow = (id: string) => ({ id, marketingConsent: null });

function setup(holders: readonly string[] | null) {
  const cache = { rolesHolding: jest.fn().mockReturnValue(holders) };
  const service = new UsersService({} as never, cache);
  // count, users, roles, staffRoles
  const fake = fakeClient([
    [{ count: 2 }],
    [userRow('u1'), userRow('u2')],
    [],
    [
      { userId: 'u1', name: 'intern', displayName: null, expiresAt: null },
      { userId: 'u2', name: 'driver', displayName: null, expiresAt: null },
    ],
  ]);
  return { service, cache, fake };
}

describe('admin user list — holding', () => {
  it('marks staff whose live role holds the permission', async () => {
    const { service, fake } = setup(['intern']);
    const result = await service.getUsers({ audience: 'staff', holding: 'attendance.own.write', tx: fake.client });
    expect(result.data[0].holdsPermission).toBe(true);
  });

  it('marks false for staff without it', async () => {
    const { service, fake } = setup(['intern']);
    const result = await service.getUsers({ audience: 'staff', holding: 'attendance.own.write', tx: fake.client });
    expect(result.data[1].holdsPermission).toBe(false);
  });

  it('answers 503 while the permission snapshot is missing', async () => {
    const { service, fake } = setup(null);
    await expect(
      service.getUsers({ audience: 'staff', holding: 'attendance.own.write', tx: fake.client }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(fake.calls()).toBe(0);
  });

  it('omits holdsPermission without holding', async () => {
    const { service, cache, fake } = setup(['intern']);
    const result = await service.getUsers({ audience: 'staff', tx: fake.client });
    expect(result.data[0]).not.toHaveProperty('holdsPermission');
    expect(cache.rolesHolding).not.toHaveBeenCalled();
  });

  it('runs the same queries as audience=staff alone', async () => {
    const plain = setup(['intern']);
    await plain.service.getUsers({ audience: 'staff', tx: plain.fake.client });
    const withHolding = setup(['intern']);
    await withHolding.service.getUsers({
      audience: 'staff',
      holding: 'attendance.own.write',
      tx: withHolding.fake.client,
    });
    expect(withHolding.fake.calls()).toBe(plain.fake.calls());
  });

  it('rejects holding without audience=staff with 400', async () => {
    const { service, fake } = setup(['intern']);
    await expect(service.getUsers({ holding: 'attendance.own.write', tx: fake.client })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(fake.calls()).toBe(0);
  });
});

describe('GetUsersQueryDto holding', () => {
  const check = (holding: string) => validate(plainToInstance(GetUsersQueryDto, { holding }));

  it('accepts a catalog permission key', async () => {
    expect(await check('attendance.own.write')).toHaveLength(0);
  });

  it('rejects an unknown permission key with 400', async () => {
    const errors = await check('not.a.permission');
    expect(errors.map((e) => e.property)).toContain('holding');
  });
});
