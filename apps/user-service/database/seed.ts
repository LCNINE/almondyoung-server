import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import * as schema from './drizzle/schema';
import { userServiceSchema, type UserServiceSchema } from './drizzle/schema';

// 미리 정의된 UUID (고정 ID 사용)
export const PREDEFINED_IDS = {
  // 역할 ID
  ROLE_MASTER: '3a2b1c0d-9e8f-7a6b-5c4d-3e2f1a0b9c8d',
  ROLE_ADMIN: '5c6d7e8f-9a0b-1c2d-3e4f-5a6b7c8d9e0f',
  ROLE_USER: '4b5c6d7e-8f9a-0b1c-2d3e-4f5a6b7c8d9e',
  ROLE_WHOLESALE: '7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f',
  // 유저 스코프 ID
  SCOPE_MASTER: '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d',
  SCOPE_USERS_READ: 'b1c2d3e4-f5a6-b7c8-d9e0-f1a2b3c4d5e6',
  SCOPE_USERS_MODIFY: 'c1d2e3f4-a5b6-c7d8-e9f0-a1b2c3d4e5f6',
  SCOPE_USERS_DELETE: 'd1e2f3a4-b5c6-d7e8-f9a0-b1c2d3e4f5a6',

  // 도매회원 스코프 ID
  SCOPE_WHOLESALE_READ: 'e2f3a4b5-c6d7-e8f9-a0b1-c2d3e4f5a6b7',

  // 관리자 스코프 ID
  SCOPE_ADMIN_ACCESS: '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
  SCOPE_ADMIN_USERS_READ: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  SCOPE_ADMIN_USERS_MODIFY: '2a3b4c5d-6e7f-8a9b-0c1d-2e3f4a5b6c7d',
  SCOPE_ADMIN_USERS_ARCHIVE: '3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d',
  SCOPE_ADMIN_USERS_PURGE: '4a5b6c7d-8e9f-0a1b-2c3d-4e5f6a7b8c9d',
  SCOPE_ADMIN_SETTINGS_READ: '5a6b7c8d-9e0f-1a2b-3c4d-5e6f7a8b9c0d',
  SCOPE_ADMIN_SETTINGS_MODIFY: '6a7b8c9d-0e1f-2a3b-4c5d-6e7f8a9b0c1d',
  SCOPE_ADMIN_LOGS_READ: '7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d',
};

// 시드 데이터 정의
const DEFAULT_ROLES = [
  {
    id: PREDEFINED_IDS.ROLE_MASTER,
    name: 'master',
    description: '마스터',
  },
  {
    id: PREDEFINED_IDS.ROLE_ADMIN,
    name: 'admin',
    description: '관리자',
  },
  {
    id: PREDEFINED_IDS.ROLE_USER,
    name: 'user',
    description: '일반 사용자',
  },
  {
    id: PREDEFINED_IDS.ROLE_WHOLESALE,
    name: 'wholesale',
    description: '도매회원',
  },
];

const DEFAULT_SCOPES = [
  {
    id: PREDEFINED_IDS.SCOPE_MASTER,
    name: 'master',
    description: '마스터 권한',
  },
  {
    id: PREDEFINED_IDS.SCOPE_USERS_READ,
    name: 'user:read',
    description: '사용자 - 사용자 정보 조회',
  },
  {
    id: PREDEFINED_IDS.SCOPE_USERS_MODIFY,
    name: 'user:modify',
    description: '사용자 - 사용자 정보 생성, 수정',
  },
  {
    id: PREDEFINED_IDS.SCOPE_USERS_DELETE,
    name: 'user:delete',
    description: '사용자 - 사용자 정보 삭제',
  },

  {
    id: PREDEFINED_IDS.SCOPE_WHOLESALE_READ,
    name: 'wholesale:read',
    description: '도매회원 - 도매 관련 정보 조회',
  },

  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_ACCESS,
    name: 'admin:access',
    description: '관리자 페이지 접근 권한 (베이스라인)',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_USERS_READ,
    name: 'admin:users:read',
    description: '관리자 - 사용자 조회만',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_USERS_MODIFY,
    name: 'admin:users:modify',
    description: '관리자 - 사용자 생성, 수정',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_USERS_ARCHIVE,
    name: 'admin:users:archive',
    description: '관리자 - 사용자 soft delete (비활성화, 휴면 처리 등)',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_USERS_PURGE,
    name: 'admin:users:purge',
    description: '관리자 - 사용자 hard delete (완전 삭제, 복구 불가)',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_SETTINGS_READ,
    name: 'admin:settings:read',
    description: '관리자 - 설정 조회',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_SETTINGS_MODIFY,
    name: 'admin:settings:modify',
    description: '관리자 - 설정 수정',
  },
  {
    id: PREDEFINED_IDS.SCOPE_ADMIN_LOGS_READ,
    name: 'admin:logs:read',
    description: '관리자 - 로그 조회',
  },
];

// 역할-스코프 연결 정의
const DEFAULT_ROLE_SCOPE_MAPPINGS = [
  {
    roleId: PREDEFINED_IDS.ROLE_MASTER,
    scopeIds: [PREDEFINED_IDS.SCOPE_MASTER],
  },
  {
    roleId: PREDEFINED_IDS.ROLE_ADMIN,
    scopeIds: [
      // 관리자는 모든 관리자 권한을 가짐
      PREDEFINED_IDS.SCOPE_ADMIN_ACCESS,
      PREDEFINED_IDS.SCOPE_ADMIN_USERS_READ,
      PREDEFINED_IDS.SCOPE_ADMIN_USERS_MODIFY,
      PREDEFINED_IDS.SCOPE_ADMIN_USERS_ARCHIVE,
      PREDEFINED_IDS.SCOPE_ADMIN_USERS_PURGE,
      PREDEFINED_IDS.SCOPE_ADMIN_SETTINGS_READ,
      PREDEFINED_IDS.SCOPE_ADMIN_SETTINGS_MODIFY,
      PREDEFINED_IDS.SCOPE_ADMIN_LOGS_READ,
    ],
  },
  {
    roleId: PREDEFINED_IDS.ROLE_USER,
    scopeIds: [
      PREDEFINED_IDS.SCOPE_USERS_READ,
      PREDEFINED_IDS.SCOPE_USERS_MODIFY,
      PREDEFINED_IDS.SCOPE_USERS_DELETE,
    ],
  },
  {
    roleId: PREDEFINED_IDS.ROLE_WHOLESALE,
    scopeIds: [
      PREDEFINED_IDS.SCOPE_WHOLESALE_READ,
      PREDEFINED_IDS.SCOPE_USERS_READ,
      PREDEFINED_IDS.SCOPE_USERS_MODIFY,
    ],
  },
];

export async function seedDatabase(client: DbService<UserServiceSchema>) {
  console.log('🌱 데이터베이스 시드 시작...');

  // 스코프 추가
  await seedScopes(client);

  // 역할 추가
  await seedRoles(client);

  // 역할-스코프 연결
  await seedRoleScopeMappings(client);

  console.log('✅ 데이터베이스 시드 완료');
}

async function seedScopes(client: DbService<UserServiceSchema>) {
  console.log('스코프 시드 중...');

  for (const scope of DEFAULT_SCOPES) {
    // 스코프가 이미 존재하는지 확인
    const exists = await client.db
      .select()
      .from(schema.scopes)
      .where(eq(schema.scopes.scopeName, scope.name))
      .limit(1);

    if (!exists || exists.length === 0) {
      // 존재하지 않으면 새로 생성
      await client.db.insert(schema.scopes).values({
        scopeId: scope.id,
        scopeName: scope.name,
        description: scope.description,
      });

      console.log(`스코프 생성됨: ${scope.name}`);
    } else {
      console.log(`스코프 이미 존재함: ${scope.name}`);
    }
  }
}

async function seedRoles(client: DbService<UserServiceSchema>) {
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

async function seedRoleScopeMappings(client: DbService<UserServiceSchema>) {
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
