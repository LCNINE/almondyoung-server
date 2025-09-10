const { Client } = require('pg');

const client = new Client({
  connectionString:
    'postgresql://neondb_owner:npg_UdDYLFvO5Tq2@ep-young-pine-a149ey1z-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function debugInsert() {
  try {
    await client.connect();

    // 정확히 Drizzle이 생성하는 것과 같은 쿼리 실행
    const result = await client.query(
      `
      INSERT INTO checkout_sessions 
      (id, intent_id, provider, redirect_url, cancel_url, status, expires_at, created_at, metadata)
      VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `,
      [
        'cs_debug_test',
        '01K4QGCZVQWRVF5HKDR4XYP6RV', // 기존에 생성한 Intent ID 사용
        'TOSS',
        'http://localhost:3000/payment-success.html',
        'http://localhost:3000/payment-fail.html',
        'PENDING',
        new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        new Date().toISOString(),
        '{"type":"universal","allowedProviders":["TOSS","KAKAOPAY","BNPL","POINTS"]}',
      ],
    );

    console.log('✅ Debug Insert 성공!');
    console.log('결과:', result.rows[0]);

    // 생성된 레코드 확인
    const checkResult = await client.query(
      'SELECT * FROM checkout_sessions WHERE id = $1',
      ['cs_debug_test'],
    );
    console.log('\n📋 생성된 레코드:', checkResult.rows[0]);
  } catch (error) {
    console.error('❌ Debug Insert 실패:');
    console.error('메시지:', error.message);
    console.error('코드:', error.code);
    console.error('상세:', error.detail);
    console.error('힌트:', error.hint);
    console.error('위치:', error.position);
    console.error('전체 스택:', error.stack);
  } finally {
    await client.end();
  }
}

debugInsert();
