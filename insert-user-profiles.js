// insert-user-profiles.js
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require'
});

// 사용자 정보
const users = [
  { 
    userId: 'user-001', 
    name: '배현지', 
    email: 'hyunji.bea@lcnine.kr', 
    phone: '010-6607-3764' 
  },
  { 
    userId: 'user-002', 
    name: '정중식', 
    email: 'jungsik.jeong@lcnine.kr', 
    phone: '010-2272-0693' 
  },
  { 
    userId: 'user-003', 
    name: '고지훈', 
    email: 'jihun.go@lcnine.kr', 
    phone: '010-7721-0149' 
  }
];

async function insertUserProfiles() {
  try {
    await client.connect();
    console.log('DB 연결 성공');

    console.log('사용자 프로필 삽입 시작...');
    for (const user of users) {
      // 먼저 기존 사용자가 있는지 확인
      const checkQuery = 'SELECT user_id FROM user_profiles WHERE user_id = $1';
      const checkResult = await client.query(checkQuery, [user.userId]);
      
      if (checkResult.rows.length > 0) {
        console.log(`⚠️ 사용자가 이미 존재함: ${user.userId}`);
        continue;
      }

      const query = `
        INSERT INTO user_profiles (user_id, email, phone_number, membership_type, synced_at)
        VALUES ($1, $2, $3, 'general', NOW())
        RETURNING user_id, email
      `;
      
      const values = [user.userId, user.email, user.phone];
      
      const result = await client.query(query, values);
      console.log(`✅ 사용자 프로필 삽입 완료: ${user.name} (${user.email})`);
    }

    console.log('\n🎉 모든 사용자 프로필이 삽입되었습니다!');
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await client.end();
  }
}

insertUserProfiles();
