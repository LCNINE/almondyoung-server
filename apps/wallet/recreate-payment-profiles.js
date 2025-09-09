const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function recreatePaymentProfiles() {
  const client = await pool.connect();

  try {
    console.log('🗑️ Dropping existing payment_profiles table...');
    await client.query('DROP TABLE IF EXISTS payment_profiles CASCADE;');

    console.log(
      '🔄 Creating payment_profiles table with exact Drizzle schema...',
    );

    await client.query(`
      CREATE TABLE payment_profiles (
          id VARCHAR(26) PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          profile_type TEXT NOT NULL,
          profile_name VARCHAR(64) NOT NULL,
          is_default BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'PENDING',
          payment_purpose TEXT NOT NULL DEFAULT 'PURCHASE',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    console.log('✅ payment_profiles table recreated successfully');

    // 테스트 INSERT
    console.log('🧪 Testing INSERT...');
    await client.query(`
      INSERT INTO payment_profiles (
        id, user_id, profile_type, profile_name, 
        is_default, status, payment_purpose,
        created_at, updated_at
      ) VALUES (
        'test_123', 'user_123', 'CARD', 'Test Card',
        false, 'ACTIVE', 'BOTH',
        NOW(), NOW()
      );
    `);

    const testResult = await client.query(
      'SELECT * FROM payment_profiles WHERE id = $1',
      ['test_123'],
    );
    console.log('📄 Test data:', testResult.rows[0]);

    await client.query('DELETE FROM payment_profiles WHERE id = $1', [
      'test_123',
    ]);
    console.log('🗑️ Test data cleaned up');
  } catch (error) {
    console.error('❌ Error recreating table:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

recreatePaymentProfiles();
