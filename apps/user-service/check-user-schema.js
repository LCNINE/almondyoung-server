require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require&channel_binding=require',
});

async function checkUserSchema() {
  try {
    console.log('🔍 User Service 스키마 확인...');

    // 1. users 테이블 구조 확인
    console.log('\n📋 1. users 테이블 구조:');
    const usersColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position;
    `);
    
    usersColumns.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // 2. user_consents 테이블 구조 확인
    console.log('\n📋 2. user_consents 테이블 구조:');
    const consentsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'user_consents' 
      ORDER BY ordinal_position;
    `);
    
    consentsColumns.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // 3. 모든 테이블 목록 확인
    console.log('\n📋 3. 모든 테이블 목록:');
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    tables.rows.forEach(table => {
      console.log(`- ${table.table_name}`);
    });

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await pool.end();
  }
}

checkUserSchema();
