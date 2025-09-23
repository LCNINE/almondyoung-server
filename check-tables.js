const { Client } = require('pg');

async function checkTables() {
  const client = new Client({
    connectionString:
      'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  });

  try {
    await client.connect();
    console.log('✅ DB 연결 성공');

    // 테이블 목록 조회
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%bnpl%'
      ORDER BY table_name;
    `);

    console.log('🔍 BNPL 관련 테이블:');
    result.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });

    if (result.rows.length === 0) {
      console.log('❌ BNPL 관련 테이블이 없습니다.');

      // 모든 테이블 조회
      const allTables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);

      console.log('\n📋 전체 테이블 목록:');
      allTables.rows.forEach((row) => {
        console.log(`  - ${row.table_name}`);
      });
    }
  } catch (error) {
    console.error('❌ 오류:', error.message);
  } finally {
    await client.end();
  }
}

checkTables();
