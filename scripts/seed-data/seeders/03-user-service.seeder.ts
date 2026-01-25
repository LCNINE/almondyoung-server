import { drizzle } from 'drizzle-orm/postgres-js';
import { InferInsertModel, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import * as userSchema from '../../../apps/user-service/database/drizzle/schema';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('User Service Seeder');

type RoleInsert = InferInsertModel<typeof userSchema.roles>;
type ScopeInsert = InferInsertModel<typeof userSchema.scopes>;
type UserInsert = InferInsertModel<typeof userSchema.users>;

export async function seedUserService(
  databaseUrl: string,
  adminPassword: string,
): Promise<void> {
  logger.info('Starting User Service seeding');

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  try {
    // Step 1: Insert Roles
    logger.step(1, 5, 'Inserting roles');

    const roles: RoleInsert[] = [
      {
        roleId: FIXED_UUIDS.ROLE_ADMIN,
        name: 'admin',
        description: '관리자',
      },
      {
        roleId: FIXED_UUIDS.ROLE_MEMBERSHIP,
        name: 'membership',
        description: '멤버십 회원',
      },
    ];

    for (const role of roles) {
      await db.execute(sql`
        INSERT INTO roles (role_id, name, description)
        VALUES (${role.roleId}, ${role.name}, ${role.description})
        ON CONFLICT (role_id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${roles.length} roles`);

    // Step 2: Insert Scopes (12 scopes from USER_SCOPES)
    logger.step(2, 5, 'Inserting scopes');

    const scopes: ScopeInsert[] = [
      {
        scopeId: FIXED_UUIDS.SCOPE_MASTER,
        scopeName: 'master',
        description: '마스터 권한',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_USER_READ,
        scopeName: 'user:read',
        description: '사용자 - 사용자 정보 조회',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_USER_MODIFY,
        scopeName: 'user:modify',
        description: '사용자 - 사용자 정보 생성, 수정',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_USER_DELETE,
        scopeName: 'user:delete',
        description: '사용자 - 사용자 정보 삭제',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_ACCESS,
        scopeName: 'admin:access',
        description: '관리자 페이지 접근 권한 (베이스라인)',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_USERS_READ,
        scopeName: 'admin:users:read',
        description: '관리자 - 사용자 조회만',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_USERS_MODIFY,
        scopeName: 'admin:users:modify',
        description: '관리자 - 사용자 생성, 수정',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_USERS_ARCHIVE,
        scopeName: 'admin:users:archive',
        description: '관리자 - 사용자 soft delete (비활성화, 휴면 처리 등)',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_USERS_PURGE,
        scopeName: 'admin:users:purge',
        description: '관리자 - 사용자 hard delete (완전 삭제, 복구 불가)',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_SETTINGS_READ,
        scopeName: 'admin:settings:read',
        description: '관리자 - 설정 조회',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_SETTINGS_MODIFY,
        scopeName: 'admin:settings:modify',
        description: '관리자 - 설정 수정',
      },
      {
        scopeId: FIXED_UUIDS.SCOPE_ADMIN_LOGS_READ,
        scopeName: 'admin:logs:read',
        description: '관리자 - 로그 조회',
      },
    ];

    for (const scope of scopes) {
      await db.execute(sql`
        INSERT INTO scopes (scope_id, scope_name, description)
        VALUES (${scope.scopeId}, ${scope.scopeName}, ${scope.description})
        ON CONFLICT (scope_id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${scopes.length} scopes`);

    // Step 3: Insert Role-Scope Mappings
    logger.step(3, 5, 'Inserting role-scope mappings');

    // Admin role gets all scopes
    const adminScopeIds = scopes.map((s) => s.scopeId);

    for (const scopeId of adminScopeIds) {
      await db.execute(sql`
        INSERT INTO role_scopes (role_id, scope_id)
        VALUES (${FIXED_UUIDS.ROLE_ADMIN}, ${scopeId})
        ON CONFLICT DO NOTHING
      `);
    }

    // Membership role gets only user:read and user:modify
    const membershipScopeIds = [
      FIXED_UUIDS.SCOPE_USER_READ,
      FIXED_UUIDS.SCOPE_USER_MODIFY,
    ];

    for (const scopeId of membershipScopeIds) {
      await db.execute(sql`
        INSERT INTO role_scopes (role_id, scope_id)
        VALUES (${FIXED_UUIDS.ROLE_MEMBERSHIP}, ${scopeId})
        ON CONFLICT DO NOTHING
      `);
    }

    logger.success(
      `Inserted role-scope mappings (admin: ${adminScopeIds.length}, membership: ${membershipScopeIds.length})`,
    );

    // Step 4: Create Admin User
    logger.step(4, 5, 'Creating admin user');

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const adminUser: UserInsert = {
      id: FIXED_UUIDS.USER_ADMIN,
      loginId: 'admin',
      username: 'Admin User',
      nickname: '관리자',
      email: 'admin@almondyoung.com',
      password: hashedPassword,
      isEmailVerified: true,
    };

    await db.execute(sql`
      INSERT INTO users (
        id, login_id, username, nickname, email, password, is_email_verified
      )
      VALUES (
        ${adminUser.id},
        ${adminUser.loginId},
        ${adminUser.username},
        ${adminUser.nickname},
        ${adminUser.email},
        ${adminUser.password},
        ${adminUser.isEmailVerified}
      )
      ON CONFLICT (id) DO NOTHING
    `);

    logger.success('Inserted admin user');

    // Step 5: Assign Admin Role to Admin User
    logger.step(5, 5, 'Assigning admin role to admin user');

    await db.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${FIXED_UUIDS.USER_ADMIN}, ${FIXED_UUIDS.ROLE_ADMIN})
      ON CONFLICT DO NOTHING
    `);

    logger.success('Assigned admin role to admin user');
    logger.success('User Service seeding completed successfully');
  } catch (error) {
    logger.error('User Service seeding failed', error);
    throw error;
  } finally {
    await client.end();
  }
}
