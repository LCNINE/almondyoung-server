const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function fixTimestampDefaults() {
  const client = await pool.connect();

  try {
    console.log('🔧 Setting DEFAULT NOW() for timestamp columns...');

    // payment_profiles 테이블의 타임스탬프 컬럼에 기본값 설정
    await client.query(`
      ALTER TABLE payment_profiles 
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET DEFAULT NOW();
    `);

    console.log('✅ payment_profiles timestamp defaults set');

    // batch_cms_profiles도 동일하게 설정
    await client.query(`
      ALTER TABLE batch_cms_profiles 
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET DEFAULT NOW();
    `);

    console.log('✅ batch_cms_profiles timestamp defaults set');

    // 테스트: DEFAULT 값으로 INSERT 해보기
    console.log('🧪 Testing INSERT with DEFAULT timestamps...');

    await client.query(`
      INSERT INTO payment_profiles (
        id, user_id, profile_type, profile_name,
        is_default, status, payment_purpose
      ) VALUES (
        'test_default_ts', 'test_user', 'CARD', 'Test Default',
        false, 'ACTIVE', 'BOTH'
      );
    `);

    const result = await client.query(
      'SELECT * FROM payment_profiles WHERE id = $1',
      ['test_default_ts'],
    );

    console.log('📄 Test result with default timestamps:');
    console.log('  created_at:', result.rows[0].created_at);
    console.log('  updated_at:', result.rows[0].updated_at);

    // 테스트 데이터 정리
    await client.query('DELETE FROM payment_profiles WHERE id = $1', [
      'test_default_ts',
    ]);
    console.log('🗑️ Test data cleaned up');
  } catch (error) {
    console.error('❌ Error setting timestamp defaults:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixTimestampDefaults();
