const { Client } = require('pg');

const client = new Client({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function checkTables() {
  try {
    await client.connect();

    // checkout_sessions 테이블 존재 확인
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('checkout_sessions', 'payment_intents', 'payment_attempts');
    `);

    console.log('📋 존재하는 테이블들:');
    result.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });

    if (result.rows.length === 0) {
      console.log('❌ v2 테이블들이 존재하지 않습니다.');
      console.log('마이그레이션을 실행해야 합니다.');
    }

    // checkout_sessions 테이블 스키마 확인
    if (result.rows.some((row) => row.table_name === 'checkout_sessions')) {
      const schemaResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'checkout_sessions' 
        ORDER BY ordinal_position;
      `);

      console.log('\n🏗️ checkout_sessions 테이블 스키마:');
      schemaResult.rows.forEach((col) => {
        console.log(
          `  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`,
        );
      });
    }
  } catch (error) {
    console.error('❌ DB 연결 오류:', error.message);
  } finally {
    await client.end();
  }
}

checkTables();
