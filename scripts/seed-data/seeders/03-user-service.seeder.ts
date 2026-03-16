import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('User Service Seeder');

export async function seedUserService(
  databaseUrl: string,
  adminPassword: string,
): Promise<void> {
  logger.info('Starting User Service seeding');

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  try {
    // Step 1: Insert public.roles (admin, membership, user)
    logger.step(1, 7, 'Inserting public roles');

    const roles = [
      {
        roleId: FIXED_UUIDS.ROLE_MASTER,
        name: 'master',
        description: '마스터',
      },
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
      {
        roleId: FIXED_UUIDS.ROLE_USER,
        name: 'user',
        description: '일반 회원',
      },
    ];

    for (const role of roles) {
      await db.execute(sql`
        INSERT INTO roles (role_id, name, description)
        VALUES (${role.roleId}, ${role.name}, ${role.description})
        ON CONFLICT (role_id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${roles.length} public roles`);

    // Step 2: Upsert auth.roles (하위 호환 유지)
    logger.step(2, 7, 'Upserting auth.roles');

    for (const role of roles) {
      await db.execute(sql`
        INSERT INTO auth.roles (name, description)
        VALUES (${role.name}, ${role.description})
        ON CONFLICT (name) DO NOTHING
      `);
    }

    logger.success('Upserted auth.roles');

    // Step 3: Upsert auth.scopes
    logger.step(3, 7, 'Upserting auth.scopes');

    const scopes = [
      { key: 'master', description: '마스터 권한', microservice_name: 'user-service' },
      { key: 'user:read', description: '사용자 - 사용자 정보 조회', microservice_name: 'user-service' },
      { key: 'user:modify', description: '사용자 - 사용자 정보 생성, 수정', microservice_name: 'user-service' },
      { key: 'user:delete', description: '사용자 - 사용자 정보 삭제', microservice_name: 'user-service' },
      { key: 'admin:access', description: '관리자 페이지 접근 권한 (베이스라인)', microservice_name: 'user-service' },
      { key: 'admin:users:*', description: '관리자 - 사용자 전체 권한', microservice_name: 'user-service' },
      { key: 'admin:users:read', description: '관리자 - 회원 조회', microservice_name: 'user-service' },
      { key: 'admin:users:modify', description: '관리자 - 회원 수정', microservice_name: 'user-service' },
      { key: 'admin:users:archive', description: '관리자 - 회원 보관', microservice_name: 'user-service' },
      { key: 'admin:users:purge', description: '관리자 - 회원 완전삭제', microservice_name: 'user-service' },
      { key: 'admin:settings:*', description: '관리자 - 설정 전체 권한', microservice_name: 'user-service' },
      { key: 'admin:logs:read', description: '관리자 - 로그 조회', microservice_name: 'user-service' },
    ];

    for (const scope of scopes) {
      await db.execute(sql`
        INSERT INTO auth.scopes (key, description, microservice_name)
        VALUES (${scope.key}, ${scope.description}, ${scope.microservice_name})
        ON CONFLICT (key) DO NOTHING
      `);
    }

    logger.success(`Upserted ${scopes.length} auth scopes`);

    // Step 4: Upsert auth.role_scope_mapping (role_name 직접 사용)
    logger.step(4, 7, 'Upserting auth.role_scope_mapping');

    const masterScopeKeys = ['master'];
    for (const scopeKey of masterScopeKeys) {
      await db.execute(sql`
        INSERT INTO auth.role_scope_mapping (role_name, scope_id)
        SELECT 'master', id FROM auth.scopes WHERE key = ${scopeKey}
        ON CONFLICT (role_name, scope_id) DO NOTHING
      `);
    }

    const adminScopeKeys = scopes.map(s => s.key).filter(k => k !== 'master');
    for (const scopeKey of adminScopeKeys) {
      await db.execute(sql`
        INSERT INTO auth.role_scope_mapping (role_name, scope_id)
        SELECT 'admin', id FROM auth.scopes WHERE key = ${scopeKey}
        ON CONFLICT (role_name, scope_id) DO NOTHING
      `);
    }

    const membershipScopeKeys = ['user:read', 'user:modify'];
    for (const scopeKey of membershipScopeKeys) {
      await db.execute(sql`
        INSERT INTO auth.role_scope_mapping (role_name, scope_id)
        SELECT 'membership', id FROM auth.scopes WHERE key = ${scopeKey}
        ON CONFLICT (role_name, scope_id) DO NOTHING
      `);
    }

    const userScopeKeys = ['user:read', 'user:modify'];
    for (const scopeKey of userScopeKeys) {
      await db.execute(sql`
        INSERT INTO auth.role_scope_mapping (role_name, scope_id)
        SELECT 'user', id FROM auth.scopes WHERE key = ${scopeKey}
        ON CONFLICT (role_name, scope_id) DO NOTHING
      `);
    }

    logger.success('Upserted auth.role_scope_mapping');

    // Step 5: Create Admin User
    logger.step(5, 7, 'Creating admin user');

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const adminUser = {
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

    // Step 6: Assign master and admin roles to admin user
    logger.step(6, 7, 'Assigning master and admin roles to admin user');

    await db.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${FIXED_UUIDS.USER_ADMIN}, ${FIXED_UUIDS.ROLE_MASTER})
      ON CONFLICT DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${FIXED_UUIDS.USER_ADMIN}, ${FIXED_UUIDS.ROLE_ADMIN})
      ON CONFLICT DO NOTHING
    `);

    logger.success('Assigned admin role to admin user');

    // Step 7: Assign 'user' role to all existing users without any role
    logger.step(7, 7, 'Assigning user role to existing users without roles');

    await db.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.role_id
      FROM users u
        CROSS JOIN roles r
      WHERE r.name = 'user'
        AND NOT EXISTS (
          SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
        )
      ON CONFLICT DO NOTHING
    `);

    logger.success('Assigned user role to existing users without roles');
    logger.success('User Service seeding completed successfully');
  } catch (error) {
    logger.error('User Service seeding failed', error);
    throw error;
  } finally {
    await client.end();
  }
}
