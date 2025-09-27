// check-notifications.js
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_27JqkIlicZHD@ep-long-pine-a10ch769-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

async function checkNotifications() {
  try {
    await client.connect();
    console.log('DB 연결 성공');

    console.log('\n📧 최근 알림 목록:');
    const notifications = await client.query(`
      SELECT notification_id, user_id, event_key, channel, status, created_at, payload
      FROM notifications 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    if (notifications.rows.length > 0) {
      notifications.rows.forEach(n => {
        console.log(`- ID: ${n.notification_id}`);
        console.log(`  User: ${n.user_id}`);
        console.log(`  Event: ${n.event_key}`);
        console.log(`  Channel: ${n.channel}`);
        console.log(`  Status: ${n.status}`);
        console.log(`  Created: ${n.created_at}`);
        console.log(`  Payload: ${JSON.stringify(n.payload)}`);
        console.log('');
      });
    } else {
      console.log('❌ 알림이 없습니다.');
    }

    console.log('\n🔗 이벤트 매핑 목록:');
    const eventMappings = await client.query(`
      SELECT event_key, name, template_key, category, default_channels, priority
      FROM notification_events
      ORDER BY event_key
    `);
    
    if (eventMappings.rows.length > 0) {
      eventMappings.rows.forEach((em, index) => {
        console.log(`${index + 1}. ${em.event_key} -> ${em.template_key}`);
        console.log(`   카테고리: ${em.category}`);
        console.log(`   채널: ${JSON.stringify(em.default_channels)}`);
        console.log(`   우선순위: ${em.priority}`);
        console.log('');
      });
    } else {
      console.log('❌ 이벤트 매핑이 없습니다.');
    }

    console.log('\n📝 템플릿 목록:');
    const templates = await client.query(`
      SELECT template_key, name, category, is_active
      FROM templates
      ORDER BY template_key
    `);
    
    if (templates.rows.length > 0) {
      templates.rows.forEach((t, index) => {
        console.log(`${index + 1}. ${t.template_key} - ${t.name}`);
        console.log(`   카테고리: ${t.category}`);
        console.log(`   활성화: ${t.is_active}`);
        console.log('');
      });
    } else {
      console.log('❌ 템플릿이 없습니다.');
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await client.end();
  }
}

checkNotifications();
