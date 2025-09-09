// 애플리케이션이 실제로 어떤 DB에 연결되는지 확인
const { Pool } = require('pg');

// 애플리케이션과 동일한 연결 설정
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

console.log(
  '🔗 Connection string:',
  connectionString.replace(/:[^@]+@/, ':****@'),
);

const pool = new Pool({ connectionString });

async function checkAppDatabase() {
  const client = await pool.connect();

  try {
    // 1. 현재 데이터베이스 확인
    const dbResult = await client.query('SELECT current_database();');
    console.log(
      '📍 App connects to database:',
      dbResult.rows[0].current_database,
    );

    // 2. payment_profiles 테이블 존재 확인
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_profiles'
      );
    `);
    console.log(
      '🏗️ payment_profiles exists in app DB:',
      tableCheck.rows[0].exists,
    );

    // 3. 모든 테이블 나열
    const allTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('📚 Tables in app database:');
    allTables.rows.forEach((row) => console.log(`  - ${row.table_name}`));

    // 4. Drizzle이 사용하는 실제 테이블 확인
    console.log('\n🔍 Checking Drizzle-specific patterns...');
    const drizzleCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%profile%'
      ORDER BY table_name;
    `);
    console.log('🎯 Profile-related tables:');
    drizzleCheck.rows.forEach((row) => console.log(`  - ${row.table_name}`));
  } catch (error) {
    console.error('❌ App database check error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkAppDatabase();
