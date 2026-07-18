import {
  UserServiceSeedStep,
  USER_SERVICE_REFERENCE_ROLES as ORCHESTRATED_ROLES,
  USER_SERVICE_REFERENCE_ROLE_SCOPE_MAP as ORCHESTRATED_ROLE_SCOPE_MAP,
} from './user-service.seed-step';
import {
  USER_SERVICE_REFERENCE_ROLES as LEGACY_ROLES,
  USER_SERVICE_REFERENCE_ROLE_SCOPE_MAP as LEGACY_ROLE_SCOPE_MAP,
} from '../../seed-data/seeders/03-user-service.seeder';
import { FIXED_UUIDS as ORCHESTRATED_UUIDS } from '../constants/uuids';
import { FIXED_UUIDS as LEGACY_UUIDS } from '../../seed-data/constants/uuids';
import { PgDialect } from 'drizzle-orm/pg-core';

describe('user-service logistics reference roles', () => {
  const expectedLogisticsRoles = [
    {
      roleId: '019d0004-0005-7000-a000-000000000005',
      name: 'logistics_worker',
      description: '물류 작업자',
    },
    {
      roleId: '019d0004-0006-7000-a000-000000000006',
      name: 'logistics_manager',
      description: '물류 관리자',
    },
  ];

  it('uses the same fixed role identities in both idempotent reference seed paths', () => {
    const logisticsOnly = (roles: typeof ORCHESTRATED_ROLES) =>
      roles.filter((role) => role.name.startsWith('logistics_'));

    expect(logisticsOnly(ORCHESTRATED_ROLES)).toEqual(expectedLogisticsRoles);
    expect(logisticsOnly(LEGACY_ROLES)).toEqual(expectedLogisticsRoles);
    expect(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_WORKER).toBe(LEGACY_UUIDS.ROLE_LOGISTICS_WORKER);
    expect(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_MANAGER).toBe(LEGACY_UUIDS.ROLE_LOGISTICS_MANAGER);
    expect(new Set(ORCHESTRATED_ROLES.map((role) => role.roleId)).size).toBe(ORCHESTRATED_ROLES.length);
    expect(new Set(LEGACY_ROLES.map((role) => role.roleId)).size).toBe(LEGACY_ROLES.length);
  });

  it('does not seed role-scope or user assignments for logistics roles', () => {
    expect(ORCHESTRATED_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_worker');
    expect(ORCHESTRATED_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_manager');
    expect(LEGACY_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_worker');
    expect(LEGACY_ROLE_SCOPE_MAP).not.toHaveProperty('logistics_manager');
  });

  it('runs the reference seed path twice with conflict-safe role inserts and no logistics user assignment', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const step = Object.create(UserServiceSeedStep.prototype) as UserServiceSeedStep;
    Object.assign(step as object, {
      db: { execute },
      logger: {
        step: jest.fn(),
        success: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      adminPassword: 'seed-test-password',
      oauthClients: [],
    });

    await expect(step.apply()).resolves.toMatchObject({ success: true });
    await expect(step.apply()).resolves.toMatchObject({ success: true });

    const dialect = new PgDialect();
    const renderedQueries = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    const roleInserts = renderedQueries.filter(({ sql }) => /insert into roles/i.test(sql));
    const userRoleInserts = renderedQueries.filter(({ sql }) => /insert into user_roles/i.test(sql));

    expect(roleInserts).toHaveLength(ORCHESTRATED_ROLES.length * 2);
    expect(roleInserts.every(({ sql }) => /on conflict \(role_id\) do nothing/i.test(sql))).toBe(true);
    expect(roleInserts.filter(({ params }) => params.includes(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_WORKER))).toHaveLength(
      2,
    );
    expect(roleInserts.filter(({ params }) => params.includes(ORCHESTRATED_UUIDS.ROLE_LOGISTICS_MANAGER))).toHaveLength(
      2,
    );
    expect(
      userRoleInserts.some(({ params }) =>
        params.some(
          (param) =>
            param === ORCHESTRATED_UUIDS.ROLE_LOGISTICS_WORKER || param === ORCHESTRATED_UUIDS.ROLE_LOGISTICS_MANAGER,
        ),
      ),
    ).toBe(false);
  });
});
