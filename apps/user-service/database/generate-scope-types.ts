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

    // 스코프를 카테고리별로 그룹화
    const scopesByCategory: Record<
      string,
      Array<{ key: string; desc: string }>
    > = {};

    scopes.forEach((scope) => {
      const [category, ...actionParts] = scope.scopeName.split(':');
      const action = actionParts.join(':');

      if (!scopesByCategory[category.toUpperCase()]) {
        scopesByCategory[category.toUpperCase()] = [];
      }

      if (action) {
        scopesByCategory[category.toUpperCase()].push({
          key: scope.scopeName,
          desc: scope.description || '',
        });
      } else {
        // master 같은 단일 스코프
        scopesByCategory['MASTER'] = [
          { key: scope.scopeName, desc: scope.description || '' },
        ];
      }
    });

    // TypeScript 파일 생성
    let fileContent = `export const USER_SCOPES = {
`;

    // 카테고리별로 스코프 생성
    Object.entries(scopesByCategory).forEach(([category, categoryScopes]) => {
      if (category === 'MASTER') {
        fileContent += `  ${category}: { key: '${categoryScopes[0].key}', desc: '${categoryScopes[0].desc}' },\n`;
      } else {
        fileContent += `  ${category}: {\n`;
        categoryScopes.forEach((scope) => {
          const actionName = scope.key.split(':').pop()?.toUpperCase() || '';
          fileContent += `    ${actionName}: { key: '${scope.key}', desc: '${scope.desc}' },\n`;
        });
        fileContent += `  },\n`;
      }
    });

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
