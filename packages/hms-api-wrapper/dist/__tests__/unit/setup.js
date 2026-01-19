"use strict";
// 단위 테스트 설정
// Mock 기반 테스트를 위한 설정
// HttpClient Mock 설정
jest.mock('../../utils/HttpClient.service');
// 환경 변수 설정 (테스트용)
process.env.NODE_ENV = 'test';
// 테스트 타임아웃 설정
jest.setTimeout(5000);
//# sourceMappingURL=setup.js.map