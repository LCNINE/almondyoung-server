import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import * as schema from './drizzle/schema';

// 미리 정의된 UUID (고정 ID 사용)
export const PREDEFINED_SCOPES = {
  MASTER: '3a2b1c0d-9e8f-7a6b-5c4d-3e2f1a0b9c8d',
  USER: '4b5c6d7e-8f9a-0b1c-2d3e-4f5a6b7c8d9e',
};

export const PREDEFINED_ROLES = {
  USER_READ: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  USER_WRITE: '2a3b4c5d-6e7f-8a9b-0c1d-2e3f4a5b6c7d',
  USER_DELETE: '3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d',
  USER_UPDATE: '4a5b6c7d-8e9f-0a1b-2c3d-4e5f6a7b8c9d',
  MASTER: '7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d',
};

// 시드 데이터 정의
const DEFAULT_SCOPES = [
  {
    id: PREDEFINED_SCOPES.MASTER,
    scopeName: 'master',
    description: '모든 관리자 기능에 접근',
  },
  {
    id: PREDEFINED_SCOPES.USER,
    scopeName: 'user',
    description: '일반 사용자 역할',
  },
];

const DEFAULT_ROLES = [
  {
    id: PREDEFINED_ROLES.MASTER,
    name: 'master',
    description: '관리자',
  },
  {
    id: PREDEFINED_ROLES.USER_READ,
    name: 'user_read',
    description: '일반 사용자 읽기 권한',
  },
  {
    id: PREDEFINED_ROLES.USER_WRITE,
    name: 'user_write',
    description: '일반 사용자 쓰기 권한',
  },

  {
    id: PREDEFINED_ROLES.USER_DELETE,
    name: 'user_delete',
    description: '일반 사용자 삭제 권한',
  },
  {
    id: PREDEFINED_ROLES.USER_UPDATE,
    name: 'user_update',
    description: '일반 사용자 수정 권한',
  },
];

// 역할-스코프 연결 정의
const DEFAULT_ROLE_SCOPE_MAPPINGS = [
  {
    roleId: PREDEFINED_ROLES.MASTER,
    scopeIds: [PREDEFINED_SCOPES.MASTER],
  },
  {
    roleId: PREDEFINED_ROLES.USER_READ,
    scopeIds: [PREDEFINED_SCOPES.USER],
  },
  {
    roleId: PREDEFINED_ROLES.USER_WRITE,
    scopeIds: [PREDEFINED_SCOPES.USER],
  },
  {
    roleId: PREDEFINED_ROLES.USER_DELETE,
    scopeIds: [PREDEFINED_SCOPES.USER],
  },
  {
    roleId: PREDEFINED_ROLES.USER_UPDATE,
    scopeIds: [PREDEFINED_SCOPES.USER],
  },
];

export async function seedDatabase(client: DbService<schema.User>) {
  console.log('🌱 데이터베이스 시드 시작...');

  // 스코프 추가
  await seedScopes(client);

  // 역할 추가
  await seedRoles(client);

  // 역할-스코프 연결
  await seedRoleScopeMappings(client);

  console.log('✅ 데이터베이스 시드 완료');
}

async function seedScopes(client: DbService<schema.User>) {
  console.log('스코프 시드 중...');

  for (const scope of DEFAULT_SCOPES) {
    // 스코프가 이미 존재하는지 확인
    const exists = await client.db
      .select()
      .from(schema.scopes)
      .where(eq(schema.scopes.scopeName, scope.scopeName))
      .limit(1);

    if (!exists || exists.length === 0) {
      // 존재하지 않으면 새로 생성
      await client.db.insert(schema.scopes).values({
        scopeId: scope.id,
        scopeName: scope.scopeName,
        description: scope.description,
      });

      console.log(`스코프 생성됨: ${scope.scopeName}`);
    } else {
      console.log(`스코프 이미 존재함: ${scope.scopeName}`);
    }
  }
}

async function seedRoles(client: DbService<schema.User>) {
  console.log('역할 시드 중...');

  for (const role of DEFAULT_ROLES) {
    // 역할이 이미 존재하는지 확인
    let existingRole = await client.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, role.name))
      .limit(1);

    if (!existingRole || existingRole.length === 0) {
      // 존재하지 않으면 새로 생성
      await client.db
        .insert(schema.roles)
        .values({
          roleId: role.id,
          name: role.name,
          description: role.description,
        })
        .returning();
      console.log(`역할 생성됨: ${role.name}`);
    } else {
      console.log(`역할 이미 존재함: ${role.name}`);
    }
  }
}

async function seedRoleScopeMappings(client: DbService<schema.User>) {
  console.log('역할-스코프 매핑 시드 중...');

  for (const mapping of DEFAULT_ROLE_SCOPE_MAPPINGS) {
    for (const scopeId of mapping.scopeIds) {
      // 이미 해당 매핑이 존재하는지 확인
      const existingMapping = await client.db
        .select()
        .from(schema.roleScopes)
        .where(
          and(
            eq(schema.roleScopes.roleId, mapping.roleId),
            eq(schema.roleScopes.scopeId, scopeId),
          ),
        )
        .limit(1);

      if (!existingMapping || existingMapping.length === 0) {
        // 존재하지 않으면 새로 생성
        await client.db.insert(schema.roleScopes).values({
          roleId: mapping.roleId,
          scopeId: scopeId,
        });

        // 역할 이름과 스코프 이름 가져오기 위한 쿼리
        const role = await client.db
          .select()
          .from(schema.roles)
          .where(eq(schema.roles.roleId, mapping.roleId))
          .limit(1)
          .then((rows) => rows[0]);

        const scope = await client.db
          .select()
          .from(schema.scopes)
          .where(eq(schema.scopes.scopeId, scopeId))
          .limit(1)
          .then((rows) => rows[0]);

        console.log(
          `역할-스코프 매핑 생성됨: ${role?.name} -> ${scope?.scopeName}`,
        );
      } else {
        console.log(`역할-스코프 매핑 이미 존재함`);
      }
    }
  }
}
