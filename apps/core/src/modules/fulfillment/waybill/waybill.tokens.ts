// HanjinConfig DI 토큰. config 는 모듈 팩토리가 loadHanjinConfig(process.env) 결과를 이 토큰으로 provide (Task 12).
export const HANJIN_CONFIG = Symbol('HANJIN_CONFIG');

// 운송장 라벨 출력일자용 시계. 기본은 new Date() — 테스트가 고정 시각을 넣는다(#913).
export const WAYBILL_LABEL_CLOCK = Symbol('WAYBILL_LABEL_CLOCK');
