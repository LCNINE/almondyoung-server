import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import * as schema from '../database/drizzle/schema';
import { DatabaseService } from './database.service';

// 미리 정의된 UUID (고정 ID 사용)
export const PREDEFINED_SCOPES = {
  ADMIN: '3a2b1c0d-9e8f-7a6b-5c4d-3e2f1a0b9c8d',
};

export const PREDEFINED_ROLES = {
  USER: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  ADMIN: '7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d',
};

// 시드 데이터 정의
const DEFAULT_SCOPES = [
  {
    id: PREDEFINED_SCOPES.ADMIN,
    name: 'admin',
    description: '관리자 기능에 접근',
    isDefault: false,
  },
];

const DEFAULT_ROLES = [
  {
    id: PREDEFINED_ROLES.USER,
    name: 'user',
    description: '일반 사용자',
    isSystemRole: true,
  },
  {
    id: PREDEFINED_ROLES.ADMIN,
    name: 'admin',
    description: '관리자',
    isSystemRole: true,
  },
];

// 역할-스코프 연결 정의
const DEFAULT_ROLE_SCOPE_MAPPINGS = [
  {
    roleId: PREDEFINED_ROLES.ADMIN,
    scopeIds: [PREDEFINED_SCOPES.ADMIN],
  },
];

export async function seedDatabase(db: DatabaseService) {
  console.log('🌱 데이터베이스 시드 시작...');

  // 스코프 추가
  await seedScopes(db);
  
  // 역할 추가
  await seedRoles(db);
  
  // 역할-스코프 연결
  await seedRoleScopeMappings(db);

  console.log('✅ 데이터베이스 시드 완료');
}

async function seedScopes(db: DatabaseService) {
  console.log('스코프 시드 중...');
  
  for (const scope of DEFAULT_SCOPES) {
    // 스코프가 이미 존재하는지 확인
    const existingScope = await db.db.query.scopes.findFirst({
      where: eq(schema.scopes.scopeId, scope.id as string),
    });
    
    if (!existingScope) {
      // 존재하지 않으면 새로 생성
      await db.db.insert(schema.scopes).values({
        scopeId: scope.id as string,
        scopeName: scope.name,
        description: scope.description,
        isDefault: scope.isDefault,
      });
      console.log(`스코프 생성됨: ${scope.name}`);
    } else {
      console.log(`스코프 이미 존재함: ${scope.name}`);
    }
  }
}

async function seedRoles(db: DatabaseService) {
  console.log('역할 시드 중...');
  
  for (const role of DEFAULT_ROLES) {
    // 역할이 이미 존재하는지 확인
    const existingRole = await db.db.query.roles.findFirst({
      where: eq(schema.roles.roleId, role.id as string),
    });
    
    if (!existingRole) {
      // 존재하지 않으면 새로 생성
      await db.db.insert(schema.roles).values({
        roleId: role.id as string,
        name: role.name,
        description: role.description,
        isSystemRole: role.isSystemRole,
      });
      console.log(`역할 생성됨: ${role.name}`);
    } else {
      console.log(`역할 이미 존재함: ${role.name}`);
    }
  }
}

async function seedRoleScopeMappings(db: DatabaseService) {
  console.log('역할-스코프 매핑 시드 중...');
  
  for (const mapping of DEFAULT_ROLE_SCOPE_MAPPINGS) {
    for (const scopeId of mapping.scopeIds) {
      // 이미 해당 매핑이 존재하는지 확인
      const existingMapping = await db.db.query.roleScopeAssignments.findFirst({
        where: (assignments) => 
          eq(assignments.roleId, mapping.roleId) && 
          eq(assignments.scopeId, scopeId),
      });
      
      if (!existingMapping) {
        // 존재하지 않으면 새로 생성
        await db.db.insert(schema.roleScopeAssignments).values({
          roleId: mapping.roleId,
          scopeId: scopeId,
        });
        
        // 역할 이름과 스코프 이름 가져오기 위한 쿼리
        const role = await db.db.query.roles.findFirst({
          where: eq(schema.roles.roleId, mapping.roleId),
        });
        
        const scope = await db.db.query.scopes.findFirst({
          where: eq(schema.scopes.scopeId, scopeId),
        });
        
        console.log(`역할-스코프 매핑 생성됨: ${role?.name} -> ${scope?.scopeName}`);
      } else {
        console.log(`역할-스코프 매핑 이미 존재함`);
      }
    }
  }
} 