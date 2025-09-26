require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require&channel_binding=require',
});

async function fixConsentsService() {
  try {
    console.log('🔧 ConsentsService 수정을 위한 SQL 테스트...');

    // 1. users와 user_consents 조인 쿼리 테스트
    console.log('\n📋 1. users와 user_consents 조인 쿼리 테스트');
    const joinQuery = `
      SELECT 
        u.id as userId,
        u.email,
        u.username as name,
        u.nickname,
        uc.marketing_consent as isMarketingEnabled
      FROM users u
      LEFT JOIN user_consents uc ON u.id = uc.user_id
      WHERE u.id IN ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002')
      ORDER BY u.email;
    `;
    
    const result = await pool.query(joinQuery);
    
    console.log('\n👥 조인된 사용자 데이터:');
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.name} (${row.email})`);
      console.log(`   ID: ${row.userId}`);
      console.log(`   마케팅 동의: ${row.ismarketingenabled ? '동의 ✅' : '미동의 ❌'}`);
      console.log('');
    });

    // 2. 마케팅 동의 여부만 확인하는 쿼리 테스트
    console.log('\n📋 2. 마케팅 동의 여부만 확인하는 쿼리 테스트');
    const marketingQuery = `
      SELECT 
        uc.marketing_consent
      FROM user_consents uc
      WHERE uc.user_id = '550e8400-e29b-41d4-a716-446655440001';
    `;
    
    const marketingResult = await pool.query(marketingQuery);
    console.log(`마케팅 동의 여부: ${marketingResult.rows[0]?.marketing_consent ? '동의' : '미동의'}`);

    console.log('\n🎉 ConsentsService 수정을 위한 SQL 테스트 완료!');

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await pool.end();
  }
}

fixConsentsService();
