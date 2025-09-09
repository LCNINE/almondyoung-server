const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function debugDatabase() {
  const client = await pool.connect();

  try {
    console.log('🔍 Checking database connection...');

    // 1. 현재 데이터베이스 확인
    const dbResult = await client.query('SELECT current_database();');
    console.log('📍 Current database:', dbResult.rows[0].current_database);

    // 2. payment_profiles 테이블 존재 여부 확인
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_profiles'
      );
    `);
    console.log('🏗️ payment_profiles table exists:', tableCheck.rows[0].exists);

    // 3. 테이블 스키마 확인
    if (tableCheck.rows[0].exists) {
      const schemaCheck = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_profiles'
        ORDER BY ordinal_position;
      `);
      console.log('📋 Table schema:');
      schemaCheck.rows.forEach((row) => {
        console.log(
          `  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default})`,
        );
      });
    }

    // 4. 직접 INSERT 테스트
    console.log('\n🧪 Testing direct INSERT...');
    try {
      await client.query(`
        INSERT INTO payment_profiles (
          id, user_id, profile_type, profile_name, 
          is_default, status, payment_purpose
        ) VALUES (
          'test_profile_123', 'test_user_123', 'CARD', 'Test Card',
          false, 'ACTIVE', 'BOTH'
        );
      `);
      console.log('✅ Direct INSERT successful');

      // 삽입된 데이터 확인
      const selectResult = await client.query(
        'SELECT * FROM payment_profiles WHERE id = $1',
        ['test_profile_123'],
      );
      console.log('📄 Inserted data:', selectResult.rows[0]);

      // 테스트 데이터 삭제
      await client.query('DELETE FROM payment_profiles WHERE id = $1', [
        'test_profile_123',
      ]);
      console.log('🗑️ Test data cleaned up');
    } catch (insertError) {
      console.error('❌ Direct INSERT failed:', insertError.message);
    }

    // 5. 모든 스키마 테이블 나열
    const allTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('\n📚 All tables in database:');
    allTables.rows.forEach((row) => console.log(`  - ${row.table_name}`));
  } catch (error) {
    console.error('❌ Database debug error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

debugDatabase();
