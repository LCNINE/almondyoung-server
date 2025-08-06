/**
 * E2E 테스트 전역 설정
 */

// Jest 타임아웃 설정
jest.setTimeout(60000);

// 전역 테스트 설정
beforeAll(async () => {
  console.log('🔧 E2E 테스트 전역 설정 시작');
  
  // 환경 변수 설정
  process.env.NODE_ENV = 'test';
  
  console.log('✅ E2E 테스트 전역 설정 완료');
});

afterAll(async () => {
  console.log('🧹 E2E 테스트 전역 정리 시작');
  
  // 필요시 전역 정리 추가
  
  console.log('✅ E2E 테스트 전역 정리 완료');
});