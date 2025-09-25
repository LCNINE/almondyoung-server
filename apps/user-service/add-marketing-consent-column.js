require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require&channel_binding=require',
});

async function addMarketingConsentColumn() {
  try {
    console.log('🔧 User Service에 marketing_consent 컬럼 추가...');

    // marketing_consent 컬럼 추가
    const addColumnSQL = `
      ALTER TABLE user_consents 
      ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false;
    `;
    
    await pool.query(addColumnSQL);
    console.log('✅ marketing_consent 컬럼 추가 완료');

    // 기존 데이터에 marketing_consent 값 설정
    // email_consent, sms_consent, push_consent 중 하나라도 true면 marketing_consent를 true로 설정
    const updateExistingDataSQL = `
      UPDATE user_consents 
      SET marketing_consent = (
        COALESCE(email_consent, false) OR 
        COALESCE(sms_consent, false) OR 
        COALESCE(push_consent, false)
      )
      WHERE marketing_consent IS NULL OR marketing_consent = false;
    `;
    
    await pool.query(updateExistingDataSQL);
    console.log('✅ 기존 데이터에 marketing_consent 값 설정 완료');

    // 업데이트된 스키마 확인
    console.log('\n📋 업데이트된 user_consents 테이블 구조:');
    const consentsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'user_consents' 
      ORDER BY ordinal_position;
    `);
    
    consentsColumns.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    console.log('\n🎉 marketing_consent 컬럼 추가 완료!');

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await pool.end();
  }
}

addMarketingConsentColumn();
