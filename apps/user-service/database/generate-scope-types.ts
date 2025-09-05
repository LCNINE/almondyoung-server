import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './drizzle/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// .env 파일 로드 (루트 디렉토리)
config({ path: join(__dirname, '../../../.env') });

/**
 * 데이터베이스에서 roles와 scopes를 읽어와서 타입 정의 파일을 생성하는 스크립트
 */
async function generateScopeTypes() {
  // PostgreSQL 연결 설정
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  });

  const db = drizzle(pool, { schema });

  try {
    console.log('데이터베이스 연결 시도 중...');
    await pool.query('SELECT 1');
    console.log('데이터베이스 연결 성공!');
    // 모든 스코프 가져오기
    const scopes = await db.select().from(schema.scopes);

    // 모든 역할 가져오기
    const roles = await db.select().from(schema.roles);

    // 역할별 스코프 매핑 가져오기
    const roleScopes = await db
      .select({
        roleName: schema.roles.name,
        scopeName: schema.scopes.scopeName,
        scopeDesc: schema.scopes.description,
      })
      .from(schema.roleScopes)
      .innerJoin(
        schema.roles,
        eq(schema.roleScopes.roleId, schema.roles.roleId),
      )
      .innerJoin(
        schema.scopes,
        eq(schema.roleScopes.scopeId, schema.scopes.scopeId),
      );

    // 스코프를 카테고리와 리소스별로 그룹화
    const scopesByCategory: Record<string, any> = {};

    scopes.forEach((scope) => {
      const parts = scope.scopeName.split(':');

      // master 같은 단일 스코프 처리
      if (parts.length === 1) {
        scopesByCategory[parts[0].toUpperCase()] = {
          key: scope.scopeName,
          desc: scope.description || '',
        };
        return;
      }

      const category = parts[0].toUpperCase(); // user, admin
      const resource = parts[1]?.toUpperCase(); // users, settings, logs
      const action = parts[2]?.toUpperCase(); // read, modify, delete, etc.

      // 카테고리 초기화
      if (!scopesByCategory[category]) {
        scopesByCategory[category] = {};
      }

      // 리소스가 있는 경우 (admin:users:read 같은 3단계 구조)
      if (resource && action) {
        // 리소스 초기화
        if (!scopesByCategory[category][resource]) {
          scopesByCategory[category][resource] = {};
        }

        scopesByCategory[category][resource][action] = {
          key: scope.scopeName,
          desc: scope.description || '',
        };
      }
      // 리소스가 없는 경우 (admin:access 같은 2단계 구조)
      else if (resource && !action) {
        scopesByCategory[category][resource] = {
          key: scope.scopeName,
          desc: scope.description || '',
        };
      }
    });

    // TypeScript 파일 생성
    let fileContent = `export const USER_SCOPES = {
`;

    // 카테고리별로 스코프 생성
    const generateScopeObject = (obj: any, indent: number = 2): string => {
      let result = '';
      const indentStr = ' '.repeat(indent);

      Object.entries(obj).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          // 타입 체크를 위한 타입 어서션
          const scopeValue = value as any;

          if (scopeValue.key && scopeValue.desc) {
            // 리프 노드 (실제 스코프 정보를 가진 객체)
            result += `${indentStr}${key}: { key: '${scopeValue.key}', desc: '${scopeValue.desc}' },\n`;
          } else {
            // 중첩된 객체
            result += `${indentStr}${key}: {\n`;
            result += generateScopeObject(scopeValue, indent + 2);
            result += `${indentStr}},\n`;
          }
        }
      });

      return result;
    };

    fileContent += generateScopeObject(scopesByCategory);
    fileContent += `} as const;\n\n`;

    // 타입 정의 추가
    fileContent += `

// USER_SCOPES의 모든 값들에서 key 추출
type ExtractKeys<T> = T extends { key: infer K }
  ? K
  : T extends object
    ? { [K in keyof T]: ExtractKeys<T[K]> }[keyof T]
    : never;

// UserScope 타입 정의
export type UserScope = ExtractKeys<typeof USER_SCOPES>;\n\n\n
`;

    // 파일 저장 경로 수정 (libs/roles/src/constants/scopes.constant.ts)

    // 파일 저장
    const outputPath = join(
      __dirname,
      '../../../libs/roles/src/constants/index.ts',
    );
    writeFileSync(outputPath, fileContent, 'utf-8');

    console.log('Type file generated:', outputPath);
    console.log(
      'Generated',
      scopes.length,
      'scopes and',
      roles.length,
      'roles',
    );
  } catch (error) {
    console.error('Error generating type file:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// 스크립트 실행
generateScopeTypes();
