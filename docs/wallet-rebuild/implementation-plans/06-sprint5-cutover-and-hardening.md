# Sprint 5 - Go-live and Hardening

## 1. 목표

신규 `wallet`를 프로덕션에 안정적으로 안착시키고 운영 안정성을 확보한다.

- 프로덕션 go-live 절차
- 운영 검증/안정화
- 롤백 가능 운영 절차
- P0 게이트 최종 통과

## 2. 범위

### In Scope

- go-live 실행 계획 수행
- 관측 지표/알람 임계치 조정
- runbook/incident 대응서 정리
- release checklist 완성

### Out of Scope

- v2 기능 추가(TOSS/BANK_TRANSFER full rollout)
- 성능 최적화 대규모 리팩터링

## 3. Go-live 계획

## 3.1 단계별 진행

1. 신규 wallet 배포(스모크/헬스/핵심 API 점검)
2. 프로덕션 트래픽을 신규 wallet로 활성화
3. 안정화 관측(결제성공률/오류율/정합성 지표)
4. 운영 기준 충족 시 go-live 완료 선언
5. `wallet-lagacy`는 동결 상태로 유지(신규 기능/데이터 이전 대상 아님)

## 3.2 데이터 정책

- `wallet-lagacy` 데이터는 신규 wallet의 마이그레이션 원천으로 사용하지 않는다.
- 신규 wallet 데이터 정합성은 신규 트래픽 기준으로 검증한다.
- legacy 데이터가 필요한 경우 운영 감사 목적의 read-only 참조만 허용한다.

## 3.3 롤백 전략

- 신규 wallet 비활성화/fallback 절차 문서화
- consumer stop/resume 순서 고정
- 장애 대응 리허설(롤백 포함)

## 4. 완료 조건 (Definition of Done)

- P0 시나리오 100% 통과
- 신규 wallet 프로덕션 결제 처리 안정화
- 심각도 높은 결함(결제금액/상태 불일치) 0건
- 운영팀 핸드오버 완료(runbook + alert + dashboard)

## 5. 검증 체크리스트

- 핵심 E2E:
  - `S-E2E-001`
  - `S-E2E-003`
  - `S-E2E-007`
  - `S-E2E-008`
- 운영:
  - 수동 큐 적체 알람 정상 동작
  - reconcile required 경보 동작
  - hmac verify 실패율 모니터링

## 6. 리스크와 대응

- 리스크: go-live 직후 운영 이슈 급증
  - 대응: 온콜 체계 + 실시간 대시보드 + 즉시 롤백 절차
- 리스크: 예상 외 consumer 순서 문제
  - 대응: outbox 기반 순차 발행 + 재처리 runbook
- 리스크: 전환 직후 운영 대응 미흡
  - 대응: 온콜 교대표 + 장애 drill 선실행

## 7. 산출물

- go-live 실행 결과 보고서
- 운영 runbook/롤백 문서
- legacy 동결 체크리스트

