// HanjinConfig DI 토큰. config 는 모듈 팩토리가 loadHanjinConfig(process.env) 결과를 이 토큰으로 provide (Task 12).
export const HANJIN_CONFIG = Symbol('HANJIN_CONFIG');
