// test/setup-e2e.ts
// E2E 테스트 전역 설정

// Mock 환경 변수 설정
process.env.USE_MOCK = 'true';
process.env.NODE_ENV = 'test';
process.env.SW_KEY = 'mock_sw_key_for_test';
process.env.CUST_KEY = 'mock_cust_key_for_test';
process.env.CUST_ID = 'mock_cust_id_for_test';

// DB 연결을 mock으로 대체
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/wallet_test';

// Jest 타임아웃 설정
jest.setTimeout(10000);

// 전역 console 설정 (테스트 중 로그 최소화)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: console.error, // 에러는 표시
};
