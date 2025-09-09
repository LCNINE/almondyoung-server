const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function createTables() {
  const client = await pool.connect();

  try {
    console.log('🔄 Creating payment_profiles table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_profiles (
          id VARCHAR(26) PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          profile_type TEXT NOT NULL CHECK (profile_type IN ('CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT')),
          profile_name VARCHAR(64) NOT NULL,
          is_default BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'FAILED')),
          payment_purpose TEXT NOT NULL DEFAULT 'PURCHASE' CHECK (payment_purpose IN ('PURCHASE', 'SUBSCRIPTION', 'BOTH')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    console.log('✅ payment_profiles table created');

    console.log('🔄 Creating batch_cms_profiles table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_cms_profiles (
          id VARCHAR(26) PRIMARY KEY REFERENCES payment_profiles(id),
          payment_profile_id VARCHAR(26) NOT NULL REFERENCES payment_profiles(id),
          hms_member_id VARCHAR(64) NOT NULL,
          hms_cust_id VARCHAR(64) NOT NULL DEFAULT 'default-cust',
          credit_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
          approved_limit NUMERIC(18, 2) NOT NULL DEFAULT 0,
          billing_cycle_day INTEGER NOT NULL DEFAULT 28,
          hms_metadata TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `);

    console.log('✅ batch_cms_profiles table created');

    // 테이블 존재 확인
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('payment_profiles', 'batch_cms_profiles')
      ORDER BY table_name;
    `);

    console.log(
      '📋 Created tables:',
      result.rows.map((r) => r.table_name),
    );
  } catch (error) {
    console.error('❌ Error creating tables:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

createTables();
