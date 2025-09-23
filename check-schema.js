const { Client } = require('pg');

async function checkSchema() {
  const client = new Client({
    connectionString:
      'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  });

  try {
    await client.connect();
    console.log('✅ DB 연결 성공');

    // bnpl_accounts 테이블 구조 확인
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'bnpl_accounts'
      ORDER BY ordinal_position;
    `);

    console.log('🔍 bnpl_accounts 테이블 구조:');
    result.rows.forEach((row) => {
      console.log(
        `  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}) ${row.column_default ? `default: ${row.column_default}` : ''}`,
      );
    });

    // 간단한 INSERT 테스트
    console.log('\n🧪 INSERT 테스트...');
    try {
      await client.query(`
        INSERT INTO bnpl_accounts (
          id, user_id, credit_limit, available_limit, status,
          billing_cycle_start, billing_cycle_end, next_billing_date
        ) VALUES (
          'test-id-123', 'test-user-123', 100000, 100000, 'ACTIVE',
          '2025-09-20', '2025-10-20', '2025-10-20'
        )
      `);
      console.log('✅ INSERT 성공');

      // 삭제
      await client.query(`DELETE FROM bnpl_accounts WHERE id = 'test-id-123'`);
      console.log('✅ 테스트 데이터 삭제 완료');
    } catch (insertError) {
      console.error('❌ INSERT 실패:', insertError.message);
    }
  } catch (error) {
    console.error('❌ 오류:', error.message);
  } finally {
    await client.end();
  }
}

checkSchema();
