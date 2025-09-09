const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function checkColumnLengths() {
  const client = await pool.connect();

  try {
    console.log('🔍 Checking column constraints...');

    // payment_profiles 테이블 컬럼 정보 조회
    const columnInfo = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'payment_profiles'
      ORDER BY ordinal_position;
    `);

    console.log('📋 payment_profiles column info:');
    columnInfo.rows.forEach((row) => {
      console.log(
        `  ${row.column_name}: ${row.data_type}${
          row.character_maximum_length
            ? `(${row.character_maximum_length})`
            : ''
        } ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`,
      );
    });

    // 테스트 데이터 길이 확인
    const testData = {
      id: 'pm_01K4PTDPKKZS69W0AGXKFDZT9J',
      user_id: 'user_123456789',
      profile_type: 'CARD',
      profile_name: '내 신용카드',
      status: 'ACTIVE',
      payment_purpose: 'BOTH',
    };

    console.log('\n📏 Test data lengths:');
    Object.entries(testData).forEach(([key, value]) => {
      const byteLength = Buffer.from(String(value), 'utf8').length;
      const charLength = String(value).length;
      console.log(
        `  ${key}: "${value}" (chars: ${charLength}, bytes: ${byteLength})`,
      );
    });

    // 컬럼 길이 늘리기
    console.log('\n🔧 Extending column lengths for Korean text...');

    await client.query(`
      ALTER TABLE payment_profiles 
      ALTER COLUMN profile_name TYPE VARCHAR(200);
    `);

    console.log('✅ profile_name extended to VARCHAR(200)');

    // 테스트 INSERT
    console.log('\n🧪 Testing INSERT with Korean text...');

    await client.query(
      `
      INSERT INTO payment_profiles (
        id, user_id, profile_type, profile_name,
        is_default, status, payment_purpose
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      )
    `,
      [
        'test_korean_text',
        'test_user_korean',
        'CARD',
        '내 신용카드 프로필 테스트용 긴 이름',
        false,
        'ACTIVE',
        'BOTH',
      ],
    );

    const result = await client.query(
      'SELECT * FROM payment_profiles WHERE id = $1',
      ['test_korean_text'],
    );

    console.log('📄 Korean text insert success:');
    console.log('  profile_name:', result.rows[0].profile_name);

    // 테스트 데이터 정리
    await client.query('DELETE FROM payment_profiles WHERE id = $1', [
      'test_korean_text',
    ]);
    console.log('🗑️ Test data cleaned up');
  } catch (error) {
    console.error('❌ Error checking column lengths:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkColumnLengths();
