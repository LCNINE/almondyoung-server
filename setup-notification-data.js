// setup-notification-data.js
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
  },
  {
    templateKey: 'ORDER_CREATED_EMAIL',
    name: '주문 생성 알림',
    category: 'TRANSACTIONAL',
    contents: {
      EMAIL: {
        ko: {
          subject: '[알몬드영] 주문이 접수되었습니다',
          body: `안녕하세요 {{name}}님,

주문이 성공적으로 접수되었습니다.

주문번호: {{orderNumber}}
주문금액: {{total}}원

감사합니다.
알몬드영 팀`
        }
      }
    },
    variablesSchema: {
      name: { type: 'string', required: true, description: '사용자 이름' },
      orderNumber: { type: 'string', required: true, description: '주문번호' },
      total: { type: 'number', required: true, description: '주문금액' }
    }
  },
  {
    templateKey: 'PAYMENT_COMPLETED_EMAIL',
    name: '결제 완료 알림',
    category: 'TRANSACTIONAL',
    contents: {
      EMAIL: {
        ko: {
          subject: '[알몬드영] 결제가 완료되었습니다',
          body: `안녕하세요 {{name}}님,

결제가 성공적으로 완료되었습니다.

주문번호: {{orderNumber}}
결제금액: {{amount}}원

감사합니다.
알몬드영 팀`
        }
      }
    },
    variablesSchema: {
      name: { type: 'string', required: true, description: '사용자 이름' },
      orderNumber: { type: 'string', required: true, description: '주문번호' },
      amount: { type: 'number', required: true, description: '결제금액' }
    }
  },
  {
    templateKey: 'MARKETING_PROMOTION_EMAIL',
    name: '마케팅 프로모션',
    category: 'MARKETING',
    contents: {
      EMAIL: {
        ko: {
          subject: '[알몬드영] 특별 할인 이벤트!',
          body: `안녕하세요 {{name}}님,

특별 할인 이벤트를 진행합니다!

할인율: {{discountRate}}%
기간: {{startDate}} ~ {{endDate}}

지금 바로 확인해보세요!
{{promotionUrl}}

감사합니다.
알몬드영 팀`
        }
      }
    },
    variablesSchema: {
      name: { type: 'string', required: true, description: '사용자 이름' },
      discountRate: { type: 'number', required: true, description: '할인율' },
      startDate: { type: 'string', required: true, description: '시작일' },
      endDate: { type: 'string', required: true, description: '종료일' },
      promotionUrl: { type: 'string', required: true, description: '프로모션 URL' }
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
  },
  {
    eventKey: 'ORDER_CREATED',
    name: '주문 생성',
    description: '주문 생성 알림',
    templateKey: 'ORDER_CREATED_EMAIL',
    category: 'TRANSACTIONAL',
    defaultChannels: ['EMAIL'],
    priority: 'NORMAL'
  },
  {
    eventKey: 'PAYMENT_COMPLETED',
    name: '결제 완료',
    description: '결제 완료 알림',
    templateKey: 'PAYMENT_COMPLETED_EMAIL',
    category: 'TRANSACTIONAL',
    defaultChannels: ['EMAIL'],
    priority: 'NORMAL'
  }
];

// 사용자 프로필 데이터
const userProfiles = [
  { 
    userId: 'user-001', 
    name: '배현지', 
    email: 'hyunji.bea@lcnine.kr', 
    phone: '010-6607-3764',
    isMarketingEnabled: true
  },
  { 
    userId: 'user-002', 
    name: '정중식', 
    email: 'jungsik.jeong@lcnine.kr', 
    phone: '010-2272-0693',
    isMarketingEnabled: true
  },
  { 
    userId: 'user-003', 
    name: '고지훈', 
    email: 'jihun.go@lcnine.kr', 
    phone: '010-7721-0149',
    isMarketingEnabled: false
  }
];

async function setupNotificationData() {
  try {
    await client.connect();
    console.log('DB 연결 성공');

    // 템플릿 삽입
    console.log('템플릿 삽입 시작...');
    for (const template of templates) {
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

    // 사용자 프로필 삽입
    console.log('\n사용자 프로필 삽입 시작...');
    for (const user of userProfiles) {
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

      // 사용자 알림 설정 삽입
      const settingsQuery = `
        INSERT INTO user_notification_settings (user_id, is_marketing_enabled, preferred_language, created_at, updated_at)
        VALUES ($1, $2, 'ko', NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          is_marketing_enabled = EXCLUDED.is_marketing_enabled,
          updated_at = NOW()
        RETURNING user_id, is_marketing_enabled
      `;
      
      const settingsValues = [user.userId, user.isMarketingEnabled];
      const settingsResult = await client.query(settingsQuery, settingsValues);
      console.log(`✅ 사용자 알림 설정 삽입 완료: ${user.name} (마케팅 동의: ${user.isMarketingEnabled})`);
    }

    console.log('\n🎉 모든 데이터 설정이 완료되었습니다!');
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  } finally {
    await client.end();
  }
}

setupNotificationData();
