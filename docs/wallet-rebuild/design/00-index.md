# Wallet Rebuild - Index (Draft)

## 1. Purpose

이 문서는 `docs/wallet-rebuild`의 단일 목차이자 작성 진행 현황 관리 문서다.
문서 번호별 범위, 상태, 작성 순서를 고정한다.

## 2. Document Map

| No | File | Status | Scope |
| --- | --- | --- | --- |
| `00` | `00-index.md` | `DONE` | 문서 목차/작성 계획/진행 현황 |
| `01` | `01-scope-and-rules.md` | `DONE` | 범위, 불변식, 핵심 정책 |
| `02` | `02-state-machines.md` | `DONE` | 엔티티 상태/전이/관리자 번역어 |
| `03` | `03-message-contracts.md` | `DONE` | Kafka command/event 계약 |
| `04` | `04-api-contracts.md` | `DONE` | HTTP REST 계약 |
| `05` | `05-data-model.md` | `DONE` | 테이블/제약/트랜잭션 패턴 |
| `06` | `06-provider-capabilities.md` | `DONE` | Provider 공통 인터페이스 + capability 매트릭스 |
| `07` | `07-hmac-integrity.md` | `DONE` | snapshot canonicalization/HMAC/replay 방지 |
| `08` | `08-compensation-and-reconcile.md` | `DONE` | 실패/만료/supersede 보상 및 수동 정리 운영 |
| `09` | `09-admin-ops.md` | `DONE` | 관리자 API/검색/재처리/감사 로그 정책 |
| `10` | `10-test-scenarios.md` | `DONE` | 단위/통합/E2E 테스트 시나리오 |
| `11` | `11-points-ledger-auth-capture.md` | `DRAFT` | POINTS 원장(user_id) + auth/capture/cancel/refund 통합 설계 |

## 3. Authoring Order

권장 작성 순서는 아래와 같다.

1. `06-provider-capabilities.md`
2. `08-compensation-and-reconcile.md`
3. `09-admin-ops.md`
4. `07-hmac-integrity.md`
5. `10-test-scenarios.md`

## 4. Notes

- `11` 문서는 POINTS 원장 통합 설계 초안(`DRAFT`) 상태다.
- 새 정책 확정 시, 관련 문서의 `Open Decisions`를 즉시 정리하고 본 문서 상태를 업데이트한다.
