"use strict";
// 통합 테스트 설정
// 실제 API 통신을 위한 설정
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// dotenv 로드 (.env 파일에서 환경변수 읽기)
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// 환경 변수 설정
process.env.NODE_ENV = 'test';
// 실제 API 키 설정 (환경 변수에서 가져옴)
if (!process.env.SW_KEY || !process.env.CUST_KEY) {
    console.warn('⚠️  실제 API 테스트를 위해서는 환경 변수를 설정하세요:');
    console.warn('   export SW_KEY="your-sw-key"');
    console.warn('   export CUST_KEY="your-cust-key"');
    console.warn('   export CUST_ID="your-cust-id"');
}
// 테스트 타임아웃 설정 (실제 API 호출은 시간이 더 걸림)
jest.setTimeout(30000);
// 실제 API 호출 시 에러 처리
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
//# sourceMappingURL=setup.js.map