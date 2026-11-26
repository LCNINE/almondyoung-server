import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { IamActor } from '../iam-actor';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { STAFF_NAMES_MAX_IDS, StaffNamesQueryDto } from './dto/staff-names.dto';
import { StaffNamesController } from './staff-names.controller';
import { StaffNamesReader } from './staff-names.reader';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const actor: IamActor = {
  userId: uuid(999),
  loginId: 'picker',
  roles: ['logistics_worker'],
  userAgent: null,
  requestId: null,
  ip: null,
  tenantId: 'acme',
};

async function parse(ids: string) {
  const dto = plainToInstance(StaffNamesQueryDto, { ids });
  const errors = await validate(dto);

  return { dto, errors };
}

describe('StaffNamesController', () => {
  it('is decided by iam.staff_name.read alone', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, StaffNamesController.prototype.names)).toEqual([
      'iam.staff_name.read',
    ]);
  });
});

describe('StaffNamesQueryDto', () => {
  it('splits the comma list into ids', async () => {
    const { dto, errors } = await parse(`${uuid(1)}, ${uuid(2)}`);

    expect(errors).toEqual([]);
    expect(dto.ids).toEqual([uuid(1), uuid(2)]);
  });

  it(`accepts at most ${STAFF_NAMES_MAX_IDS} ids`, async () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => uuid(i + 1)).join(',');

    expect((await parse(ids(STAFF_NAMES_MAX_IDS))).errors).toEqual([]);
    expect((await parse(ids(STAFF_NAMES_MAX_IDS + 1))).errors).not.toEqual([]);
  });

  it('rejects a non-uuid and an empty list', async () => {
    expect((await parse(`${uuid(1)},nope`)).errors).not.toEqual([]);
    expect((await parse('')).errors).not.toEqual([]);
  });
});

describe('StaffNamesReader', () => {
  it('asks for live staff names in the requester tenant, once per id', async () => {
    const liveStaffNamesIn = jest.fn().mockResolvedValue([{ id: uuid(1), name: '김작업' }]);
    const resolve = jest.fn().mockResolvedValue('acme');
    const module = await Test.createTestingModule({
      providers: [
        StaffNamesReader,
        { provide: RoleRepository, useValue: { liveStaffNamesIn } },
        { provide: ActorTenantReader, useValue: { resolve } },
      ],
    }).compile();
    const reader = module.get(StaffNamesReader);

    const names = await reader.namesOf(actor, [uuid(1), uuid(2), uuid(1)]);

    expect(resolve).toHaveBeenCalledWith(actor);
    expect(liveStaffNamesIn).toHaveBeenCalledWith([uuid(1), uuid(2)], 'acme');
    expect(names).toEqual([{ id: uuid(1), name: '김작업' }]);
  });
});
