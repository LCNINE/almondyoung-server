# Wallet Rebuild - Implementation Plans Index

## 문서 목적

이 디렉토리는 `design` 문서를 실제 구현 단위로 분해한 실행 문서 모음이다.  
`01-wallet-rebuild-implementation-plan.md`를 상위 계획(마스터 플랜)으로 두고, 스프린트별 세부 실행 문서를 연결한다.

## 문서 맵

| No | File | Scope |
| --- | --- | --- |
| `00` | `00-index.md` | 구현 계획 문서 인덱스 |
| `01` | `01-wallet-rebuild-implementation-plan.md` | 전체 구현/go-live 마스터 플랜 |
| `02` | `02-sprint1-foundation.md` | 앱 골격 + 데이터 모델 + 상태 전이 프레임워크 |
| `03` | `03-sprint2-checkout-and-intent.md` | Intent/Leg/HMAC/Idempotency/POINTS 결제 경로 |
| `04` | `04-sprint3-refund-compensation-messaging.md` | 환불/보상/정합성 + 명령/이벤트 + outbox |
| `05` | `05-sprint4-admin-webhook-and-ops.md` | 관리자 API + 웹훅 경계 + 운영 가시성 |
| `06` | `06-sprint5-cutover-and-hardening.md` | 신규 wallet go-live, legacy 동결, 릴리즈 하드닝 |
| `07` | `07-phase4-messaging-and-outbox-detail.md` | Phase 4 메시징/Outbox 상세 실행 계획 |
| `08` | `08-phase5a-payment-safety-refactor-no-webhook.md` | Webhook 제외 결제안전 리팩토링(Exactly-once/Idempotency/Outbox/서비스분해) |

## 진행 원칙

- 각 스프린트 종료 시 P0 회귀 시나리오를 실행한다.
- 설계 불변식 위반 이슈는 다음 스프린트로 이월하지 않는다.
- 문서 변경 시 관련 `design` 문서와 동기화한다.
