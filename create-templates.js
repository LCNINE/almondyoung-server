// create-templates.js
const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api/v1';

// 사용자 정보
const users = [
  { name: '배현지', email: 'hyunji.bea@lcnine.kr', phone: '010-6607-3764' },
  { name: '정중식', email: 'jungsik.jeong@lcnine.kr', phone: '010-2272-0693' },
  { name: '고지훈', email: 'jihun.go@lcnine.kr', phone: '010-7721-0149' }
];

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
          body: `
안녕하세요 {{name}}님,

알몬드영 회원가입을 환영합니다!

아래 링크를 클릭하여 이메일 인증을 완료해주세요:
{{callbackUrl}}

인증 후 {{redirectTo}}로 이동됩니다.

감사합니다.
알몬드영 팀
          `.trim()
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
          body: `
안녕하세요,

요청하신 아이디 찾기 결과를 안내드립니다.

등록된 아이디: {{loginId}}

감사합니다.
알몬드영 팀
          `.trim()
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
          body: `
안녕하세요,

비밀번호 재설정을 위한 링크를 안내드립니다.

아래 링크를 클릭하여 새 비밀번호를 설정해주세요:
{{resetUrl}}

감사합니다.
알몬드영 팀
          `.trim()
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

async function createTemplates() {
  console.log('템플릿 생성 시작...');
  
  for (const template of templates) {
    try {
      console.log(`템플릿 생성 중: ${template.templateKey}`);
      const response = await axios.post(`${BASE_URL}/templates`, template);
      console.log(`✅ 템플릿 생성 완료: ${template.templateKey}`, response.data);
    } catch (error) {
      console.error(`❌ 템플릿 생성 실패: ${template.templateKey}`, error.response?.data || error.message);
    }
  }
}

async function createEventMappings() {
  console.log('\n이벤트 매핑 생성 시작...');
  
  for (const mapping of eventMappings) {
    try {
      console.log(`이벤트 매핑 생성 중: ${mapping.eventKey}`);
      const response = await axios.post(`${BASE_URL}/events`, mapping);
      console.log(`✅ 이벤트 매핑 생성 완료: ${mapping.eventKey}`, response.data);
    } catch (error) {
      console.error(`❌ 이벤트 매핑 생성 실패: ${mapping.eventKey}`, error.response?.data || error.message);
    }
  }
}

async function main() {
  try {
    await createTemplates();
    await createEventMappings();
    console.log('\n🎉 모든 템플릿과 이벤트 매핑이 생성되었습니다!');
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  }
}

main();
