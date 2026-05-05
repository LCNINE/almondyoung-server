# Legacy backfill scripts

이 디렉토리는 **Phase 5 백필 v1 시점**에 사용되었던 스크립트들을 보관합니다.
신규 백필은 모두 상위 디렉토리의 `backfill-v2.ts` 흐름을 사용하세요.

## 보관된 스크립트

| 파일 | 용도 (당시 기준) | 대체 |
|------|-----------------|------|
| `migrate-pim-to-medusa.ts` | PIM HTTP API(`PimClient`) 경유 백필. 현재는 PIM API 자체가 폐기된 상태 — Core 통합 이후 사용 불가 | `backfill-v2.ts` (DB 직결) |
| `migrate-pim-to-medusa-branch.ts` | Medusa DB 분기 환경에서의 격리 백필 | `backfill-v2.ts --limit=N` 표본 실행 |
| `check-medusa-variants.ts` | PIM ↔ Medusa variant 수 정합성 검증 (HTTP) | `verify-migration.ts` (DB 카운트 비교) |
| `delete-medusa-products.ts` | handle 목록으로 Medusa 상품 일괄 삭제 (운영 디버깅) | 필요 시 그대로 사용 가능하나, 운영 환경 영향 큼 — 신중히 |

## 주의사항

- **`PIM_SOURCE_DB_URL` 환경변수**를 그대로 사용합니다. 신규 스크립트는 `CORE_DB_URL`을 사용하므로 혼동에 주의하세요.
- **`PimClient`** 를 import 하는 스크립트는 PIM HTTP API 가 살아있던 시절 동작을 가정합니다. Core 통합 이후엔 동작하지 않을 가능성이 높습니다.
- 이 디렉토리의 스크립트는 **신규 기능을 추가하지 않습니다.** 디버깅·참조용으로만 보관.
