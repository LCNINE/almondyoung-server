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
| `test-orchestration.ts` | 어댑터 오케스트레이션 수동 점검 (command/poll/webhook) | 없음 — 아래 참조 |
| `test-coupang-sync.ts` | 쿠팡 동기화 수동 점검 | 없음 — 아래 참조 |
| `test-naver-sync.ts` | 네이버 동기화/토큰 수동 점검 | 없음 — 아래 참조 |
| `test-coupang-single.ts` | shipmentBoxId 하나로 쿠팡 발송처리 수동 점검 | 없음 — 아래 참조 |

### 2026-08-13: 수동 점검 스크립트 4종 이관

위 `test-*.ts` 4개는 원래 `apps/channel-adapter/` 최상단에 있었고 `npm run
test:orchestration` / `test:coupang:sync` / `test:naver-sync` 로 배선돼 있었다.
그런데 넷 다 `./src/services/adapters/…`, `./src/services/apis/…` 를 import 하는데
그 경로는 어댑터 재배치 이후 **존재하지 않는다**. 즉 오늘 실행하면 전부
`Cannot find module` 로 즉사한다(실측 확인). 배선된 npm 명령 6개도 같이 죽어 있었다.

되살리려면 import 경로(`src/adapters/naver/…`, `src/adapters/coupang/…`)뿐 아니라
생성자 시그니처와 `ChannelCommand` 타입(`dispatch.confirm` → `dispatch.ship`)까지
현재 API 로 옮겨야 한다. 그 작업 없이 타입만 맞추는 건 의미가 없어 아카이브로
옮기고 죽은 npm 명령을 걷어냈다.

## 주의사항

- **`PIM_SOURCE_DB_URL` 환경변수**를 그대로 사용합니다. 신규 스크립트는 `CORE_DB_URL`을 사용하므로 혼동에 주의하세요.
- **`PimClient`** 를 import 하는 스크립트는 PIM HTTP API 가 살아있던 시절 동작을 가정합니다. Core 통합 이후엔 동작하지 않을 가능성이 높습니다.
- 이 디렉토리의 스크립트는 **신규 기능을 추가하지 않습니다.** 디버깅·참조용으로만 보관.
