// insert-templates-direct.js
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require'
});

// 템플릿 데이터
const templates = [
  {
    templateKey: 'USER_VERIFICATION_EMAIL',
    name: '이메일 인증',
    category: 'SYSTEM',
    contents: {
      EMAIL: {
        ko: {
          subject: '[알몬드영] 이메일 인증을 완료해주세요',
          body: `안녕하세요 {{name}}님,

알몬드영 회원가입을 환영합니다!

아래 링크를 클릭하여 이메일 인증을 완료해주세요:
{{callbackUrl}}

인증 후 {{redirectTo}}로 이동됩니다.

감사합니다.
알몬드영 팀`
        }
      }
    },
    variablesSchema: {
      name: { type: 'string', required: true, description: '사용자 이름' },
      callbackUrl: { type: 'string', required: true, description: '인증 링크' },
      redirectTo: { type: 'string', required: true, description: '리다이렉트 URL' }
    }
  },
  {
    templateKey: 'USER_FIND_ID_EMAIL',
    name: 'ID 찾기',
    category: 'SYSTEM',
    contents: {
      EMAIL: {
        ko: {
          subject: '[알몬드영] 아이디 찾기 결과',
          body: `안녕하세요,

요청하신 아이디 찾기 결과를 안내드립니다.

등록된 아이디: {{loginId}}

감사합니다.
알몬드영 팀`
        }
      }
    },
    variablesSchema: {
      loginId: { type: 'string', required: true, description: '로그인 ID' }
    }
  },
  {
    templateKey: 'USER_RESET_PASSWORD_EMAIL',
    name: '비밀번호 재설정',
    category: 'SYSTEM',
    contents: {
      EMAIL: {
        ko: {
          subject: '[알몬드영] 비밀번호 재설정',
          body: `안녕하세요,

비밀번호 재설정을 위한 링크를 안내드립니다.

아래 링크를 클릭하여 새 비밀번호를 설정해주세요:
{{resetUrl}}

감사합니다.
알몬드영 팀`
        }
      }
    },
    variablesSchema: {
      resetUrl: { type: 'string', required: true, description: '비밀번호 재설정 링크' }
    }
  }
];

// 이벤트 매핑 데이터
const eventMappings = [
  {
    eventKey: 'USER_VERIFICATION',
    name: '사용자 이메일 인증',
    description: '회원가입 시 이메일 인증 알림',
    templateKey: 'USER_VERIFICATION_EMAIL',
    category: 'SYSTEM',
    defaultChannels: ['EMAIL'],
    priority: 'HIGH'
  },
  {
    eventKey: 'USER_FIND_ID',
    name: '아이디 찾기',
    description: '아이디 찾기 결과 알림',
    templateKey: 'USER_FIND_ID_EMAIL',
    category: 'SYSTEM',
    defaultChannels: ['EMAIL'],
    priority: 'HIGH'
  },
  {
    eventKey: 'USER_RESET_PASSWORD',
    name: '비밀번호 재설정',
    description: '비밀번호 재설정 알림',
    templateKey: 'USER_RESET_PASSWORD_EMAIL',
    category: 'SYSTEM',
    defaultChannels: ['EMAIL'],
    priority: 'HIGH'
  }
];

async function insertTemplates() {
  try {
    await client.connect();
    console.log('DB 연결 성공');

    // 템플릿 삽입
    console.log('템플릿 삽입 시작...');
    for (const template of templates) {
      // 먼저 기존 템플릿이 있는지 확인
      const checkQuery = 'SELECT template_id FROM templates WHERE template_key = $1';
      const checkResult = await client.query(checkQuery, [template.templateKey]);
      
      if (checkResult.rows.length > 0) {
        console.log(`⚠️ 템플릿이 이미 존재함: ${template.templateKey}`);
        continue;
      }

      const query = `
        INSERT INTO templates (template_key, name, category, contents, variables_schema, version, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 1, true, NOW(), NOW())
        RETURNING template_id, template_key
      `;
      
      const values = [
        template.templateKey,
        template.name,
        template.category,
        JSON.stringify(template.contents),
        JSON.stringify(template.variablesSchema)
      ];
      
      const result = await client.query(query, values);
      console.log(`✅ 템플릿 삽입 완료: ${template.templateKey} (ID: ${result.rows[0].template_id})`);
    }

    // 이벤트 매핑 삽입
    console.log('\n이벤트 매핑 삽입 시작...');
    for (const mapping of eventMappings) {
      // 먼저 기존 이벤트가 있는지 확인
      const checkQuery = 'SELECT event_id FROM notification_events WHERE event_key = $1';
      const checkResult = await client.query(checkQuery, [mapping.eventKey]);
      
      if (checkResult.rows.length > 0) {
        console.log(`⚠️ 이벤트가 이미 존재함: ${mapping.eventKey}`);
        continue;
      }

      const query = `
        INSERT INTO notification_events (event_key, name, description, template_key, category, default_channels, priority, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
        RETURNING event_id, event_key
      `;
      
      const values = [
        mapping.eventKey,
        mapping.name,
        mapping.description,
        mapping.templateKey,
        mapping.category,
        JSON.stringify(mapping.defaultChannels),
        mapping.priority
      ];
      
      const result = await client.query(query, values);
      console.log(`✅ 이벤트 매핑 삽입 완료: ${mapping.eventKey} (ID: ${result.rows[0].event_id})`);
    }

    console.log('\n🎉 모든 템플릿과 이벤트 매핑이 삽입되었습니다!');
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await client.end();
  }
}

insertTemplates();
