const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function createNormalizedTables() {
  const client = await pool.connect();

  try {
    console.log('🔄 Creating normalized payment profile tables...');

    // 1. 기존 테이블 백업 (필요시)
    console.log('📋 Backing up existing tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_profiles_backup AS 
      SELECT * FROM payment_profiles;
    `);

    // 2. 기존 테이블 삭제 (CASCADE로 관련 테이블도 정리)
    console.log('🗑️ Dropping old tables...');
    await client.query('DROP TABLE IF EXISTS cms_card_profiles CASCADE;');
    await client.query('DROP TABLE IF EXISTS cms_batch_profiles CASCADE;');
    await client.query('DROP TABLE IF EXISTS card_profile CASCADE;');
    await client.query('DROP TABLE IF EXISTS batch_cms_profiles CASCADE;');

    // payment_profiles는 마지막에 재생성
    await client.query('DROP TABLE IF EXISTS payment_profiles CASCADE;');

    // 3. 새로운 정규화된 테이블 생성
    console.log('🔧 Creating normalized payment_profiles table...');
    await client.query(`
      CREATE TABLE payment_profiles (
        id VARCHAR(26) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        provider VARCHAR(16) NOT NULL DEFAULT 'CMS',
        kind VARCHAR(16) NOT NULL CHECK (kind IN ('CARD', 'BATCH')),
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'INACTIVE')),
        name VARCHAR(64),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    console.log('🔧 Creating cms_card_profiles table...');
    await client.query(`
      CREATE TABLE cms_card_profiles (
        id VARCHAR(26) PRIMARY KEY REFERENCES payment_profiles(id) ON DELETE CASCADE,
        member_id VARCHAR(20) NOT NULL UNIQUE,
        cms_status VARCHAR(16) NOT NULL,
        payment_company VARCHAR(3),
        card_last4 VARCHAR(4),
        card_brand VARCHAR(32),
        payer_name VARCHAR(64),
        phone_mask VARCHAR(20),
        billing_day INTEGER CHECK (billing_day >= 1 AND billing_day <= 31),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    console.log('🔧 Creating cms_batch_profiles table...');
    await client.query(`
      CREATE TABLE cms_batch_profiles (
        id VARCHAR(26) PRIMARY KEY REFERENCES payment_profiles(id) ON DELETE CASCADE,
        member_id VARCHAR(20) NOT NULL UNIQUE,
        cms_status VARCHAR(16) NOT NULL,
        payment_company VARCHAR(3),
        payer_name VARCHAR(64),
        phone_mask VARCHAR(20),
        billing_day INTEGER CHECK (billing_day >= 1 AND billing_day <= 31),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    // 4. 인덱스 생성
    console.log('📊 Creating indexes...');
    await client.query(`
      CREATE INDEX idx_payment_profiles_user ON payment_profiles(user_id);
      CREATE INDEX idx_payment_profiles_provider_kind ON payment_profiles(provider, kind);
      CREATE UNIQUE INDEX uq_cms_card_member ON cms_card_profiles(member_id);
      CREATE INDEX idx_cms_card_status ON cms_card_profiles(cms_status);
      CREATE UNIQUE INDEX uq_cms_batch_member ON cms_batch_profiles(member_id);
      CREATE INDEX idx_cms_batch_status ON cms_batch_profiles(cms_status);
    `);

    // 5. 테스트 데이터 삽입
    console.log('🧪 Testing normalized tables...');

    const testProfileId = 'test_normalized_profile';
    const testMemberId = '12345678901234567890';

    // 카드 프로필 테스트
    await client.query(
      `
      INSERT INTO payment_profiles (id, user_id, provider, kind, status, name)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [testProfileId, 'test_user', 'CMS', 'CARD', 'PENDING', '신한 **1234'],
    );

    await client.query(
      `
      INSERT INTO cms_card_profiles (id, member_id, cms_status, payment_company, card_last4, card_brand, payer_name, phone_mask, billing_day)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
      [
        testProfileId,
        testMemberId,
        'REGISTERED',
        '088',
        '1234',
        'SHINHAN',
        '홍*동',
        '010****5678',
        25,
      ],
    );

    // 테스트 조회
    const result = await client.query(
      `
      SELECT 
        p.id, p.user_id, p.kind, p.status, p.name,
        c.member_id, c.cms_status, c.card_brand, c.card_last4
      FROM payment_profiles p
      LEFT JOIN cms_card_profiles c ON p.id = c.id
      WHERE p.id = $1
    `,
      [testProfileId],
    );

    console.log('📄 Test result:', result.rows[0]);

    // 테스트 데이터 정리
    await client.query('DELETE FROM payment_profiles WHERE id = $1', [
      testProfileId,
    ]);
    console.log('🗑️ Test data cleaned up');

    console.log('✅ All normalized tables created successfully!');

    // 6. 테이블 목록 확인
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%profile%'
      ORDER BY table_name;
    `);

    console.log('📚 Profile-related tables:');
    tables.rows.forEach((row) => console.log(`  - ${row.table_name}`));
  } catch (error) {
    console.error('❌ Error creating normalized tables:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

createNormalizedTables();
