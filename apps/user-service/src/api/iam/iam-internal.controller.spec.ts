import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IamInternalController, type EtagReply } from './iam-internal.controller';
import { DbService } from '@app/db';
import { InternalApiKeyGuard } from '../../commons/guards/internal-api-key.guard';
import { IamService } from './iam.service';
import { MyPermissionsReader } from './my-permissions.reader';
import { PlatformTenantReader } from './platform/platform-tenant.reader';
import { PlatformRepository } from './platform/platform.repository';
import { RolePermissionsReader } from './role-permissions.reader';
import { PlatformOperatorManager } from './tenancy/platform-operator.manager';

describe('IamInternalController', () => {
  const snapshot = { version: 'abc123', roles: { admin: ['a.b.read'] } };
  const service = { roleSnapshot: jest.fn().mockResolvedValue(snapshot) };
  let controller: IamInternalController;

  const reply = () => {
    const calls = { status: [] as number[], headers: [] as [string, string][] };
    const fake: EtagReply = {
      status(code) {
        calls.status.push(code);
        return fake;
      },
      header(name, value) {
        calls.headers.push([name, value]);
        return fake;
      },
    };
    return { fake, calls };
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [IamInternalController],
      providers: [
        { provide: IamService, useValue: service },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    controller = module.get(IamInternalController);
  });

  it('answers 304 with no body when the caller already has this content', async () => {
    const { fake, calls } = reply();
    expect(await controller.rolePermissions('"abc123"', fake)).toBeUndefined();
    expect(calls.status).toEqual([304]);
  });

  it('returns the snapshot with an ETag when the content changed', async () => {
    const { fake, calls } = reply();
    expect(await controller.rolePermissions('"old"', fake)).toEqual(snapshot);
    expect(calls.headers).toContainEqual(['ETag', '"abc123"']);
    expect(calls.status).toEqual([]);
  });

  it('returns the snapshot when the caller sends no ETag', async () => {
    const { fake } = reply();
    expect(await controller.rolePermissions(undefined, fake)).toEqual(snapshot);
  });
});

describe('IamInternalController — tenant statuses (core 정지 스위치)', () => {
  const row = (id: string, status: 'preparing' | 'active' | 'suspended') => ({
    id,
    slug: `t${id}`,
    status,
    displayName: `테넌트 ${id}`,
    logoUrl: 'https://logo',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('내부 키로만 열고, 모든 테넌트의 id·상태만 돌려준다(이름·로고·도메인 없음)', async () => {
    const module = await Test.createTestingModule({
      controllers: [IamInternalController],
      providers: [
        IamService,
        PlatformTenantReader,
        { provide: RolePermissionsReader, useValue: {} },
        { provide: MyPermissionsReader, useValue: {} },
        { provide: PlatformOperatorManager, useValue: {} },
        { provide: DbService, useValue: {} },
        {
          provide: PlatformRepository,
          useValue: {
            listTenants: () => Promise.resolve([row('1', 'active'), row('2', 'suspended'), row('3', 'preparing')]),
          },
        },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const controller = module.get(IamInternalController);

    expect(await controller.tenantStatuses()).toEqual({
      tenants: [
        { id: '1', status: 'active' },
        { id: '2', status: 'suspended' },
        { id: '3', status: 'preparing' },
      ],
    });
    const handler: unknown = Object.getOwnPropertyDescriptor(IamInternalController.prototype, 'tenantStatuses')?.value;
    if (typeof handler !== 'function') throw new Error('tenantStatuses handler not found');
    const guards: unknown = Reflect.getMetadata('__guards__', handler);
    expect(guards).toContain(InternalApiKeyGuard);
  });
});
