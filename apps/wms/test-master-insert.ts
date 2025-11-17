/**
 * Master INSERT 테스트 스크립트
 * 직접 실행하여 INSERT 쿼리 동작 확인
 */
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, eq } from 'drizzle-orm';
import { wmsTables } from './database/schemas/wms-schema';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 환경 변수 로드
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

async function testMasterInsert() {
  // DB 연결 문자열 가져오기
  const connectionString = process.env.DATABASE_URL || process.env.WMS_DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL 또는 WMS_DATABASE_URL 환경 변수가 설정되지 않았습니다.');
    console.log('환경 변수 예시:');
    console.log('DATABASE_URL=postgresql://user:password@localhost:5432/dbname');
    process.exit(1);
  }

  console.log('🔌 데이터베이스 연결 중...');
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema: wmsTables });

  try {
    console.log('\n📝 테스트 1: 기본 필드만 INSERT (optionSchema, defaultPolicy 없음)');
    console.log('----------------------------------------');
    
    const [test1] = await db
      .insert(wmsTables.inventoryProductMasters)
      .values({
        name: '테스트 상품 1',
        masterCode: `TEST-${Date.now()}`,
        status: 'active' as any,
      })
      .returning();
    
    console.log('✅ 성공:', test1.id);
    console.log('생성된 레코드:', {
      id: test1.id,
      name: test1.name,
      masterCode: test1.masterCode,
      status: test1.status,
    });

    // 정리
    await db
      .delete(wmsTables.inventoryProductMasters)
      .where(eq(wmsTables.inventoryProductMasters.id, test1.id));
    console.log('🧹 테스트 데이터 삭제 완료\n');

    console.log('📝 테스트 2: optionSchema와 defaultPolicy 포함 INSERT');
    console.log('----------------------------------------');
    
    const optionSchema = {
      options: [
        { name: '색상', values: ['빨강', '파랑', '노랑'] },
        { name: '사이즈', values: ['S', 'M', 'L', 'XL'] },
      ],
    };
    
    const defaultPolicy = {
      autoCreateSkus: true,
      defaultLocation: 'A-01-01',
      safetyStock: 10,
      reorderPoint: 20,
    };

    // 방법 1: 한 번에 INSERT 시도 (id 명시하지 않음 - 자동 생성)
    try {
      const [test2] = await db
        .insert(wmsTables.inventoryProductMasters)
        .values({
          name: '테스트 상품 2',
          masterCode: `TEST-${Date.now()}`,
          status: 'active' as any,
          optionSchema: optionSchema as any,
          defaultPolicy: defaultPolicy as any,
          // id는 명시하지 않음 - DEFAULT gen_random_uuid()가 자동 생성해야 함
        })
        .returning();
      
      console.log('✅ 방법 1 성공:', test2.id);
      console.log('생성된 레코드:', {
        id: test2.id,
        name: test2.name,
        masterCode: test2.masterCode,
        hasOptionSchema: !!test2.optionSchema,
        hasDefaultPolicy: !!test2.defaultPolicy,
      });

      // 정리
      await db
        .delete(wmsTables.inventoryProductMasters)
        .where(eq(wmsTables.inventoryProductMasters.id, test2.id));
      console.log('🧹 테스트 데이터 삭제 완료\n');
    } catch (error: any) {
      console.error('❌ 방법 1 실패:', error.message);
      console.log('\n📝 방법 2: 두 단계로 나누어 INSERT 후 UPDATE');
      console.log('----------------------------------------');
      
      // 방법 2: 두 단계로 나누기
      const [created] = await db
        .insert(wmsTables.inventoryProductMasters)
        .values({
          name: '테스트 상품 2',
          masterCode: `TEST-${Date.now()}`,
          status: 'active' as any,
        })
        .returning();
      
      console.log('✅ 1단계 INSERT 성공:', created.id);
      
      const [updated] = await db
        .update(wmsTables.inventoryProductMasters)
        .set({
          optionSchema: optionSchema as any,
          defaultPolicy: defaultPolicy as any,
        })
        .where(eq(wmsTables.inventoryProductMasters.id, created.id))
        .returning();
      
      console.log('✅ 2단계 UPDATE 성공');
      console.log('최종 레코드:', {
        id: updated.id,
        name: updated.name,
        masterCode: updated.masterCode,
        hasOptionSchema: !!updated.optionSchema,
        hasDefaultPolicy: !!updated.defaultPolicy,
      });

      // 정리
      await db
        .delete(wmsTables.inventoryProductMasters)
        .where(eq(wmsTables.inventoryProductMasters.id, updated.id));
      console.log('🧹 테스트 데이터 삭제 완료\n');
    }

    console.log('✅ 모든 테스트 완료!');
    
  } catch (error: any) {
    console.error('❌ 테스트 실패:', error);
    console.error('에러 상세:', error.message);
    if (error.stack) {
      console.error('스택 트레이스:', error.stack);
    }
  } finally {
    await client.end();
    console.log('🔌 데이터베이스 연결 종료');
  }
}

// 스크립트 실행
testMasterInsert()
  .then(() => {
    console.log('\n✨ 테스트 스크립트 종료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 치명적 오류:', error);
    process.exit(1);
  });

