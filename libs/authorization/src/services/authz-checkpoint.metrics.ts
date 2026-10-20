import { Counter, register } from 'prom-client';

/**
 * 판정 지점 그림자 지표 — 모듈 스코프 싱글턴(인스턴스 필드면 전역 register 중복 등록 예외).
 * checkpoint 라벨은 코드에 고정된 리터럴이라 값의 수가 코드로 정해진다(`role-name-checks.spec.ts`).
 */
export const checkpointEvaluationsTotal = new Counter({
  name: 'authz_checkpoint_evaluations_total',
  help: 'Permission decisions computed next to in-handler role checks, by how they compared',
  labelNames: ['service', 'checkpoint', 'outcome'],
  registers: [register],
});
