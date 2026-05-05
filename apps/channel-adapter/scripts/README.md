# Channel Adapter scripts

Core(구 PIM) → Medusa 백필/마이그레이션 운영 스크립트.

## 환경변수

| 키 | 설명 |
|---|---|
| `CORE_DB_URL` | Core(legacy PIM 도메인) DB connection string. read-only 접근 권장. |
| `DATABASE_URL` | Channel Adapter 자체 DB. 매핑 테이블/세션 체크포인트 저장용. |
| `MEDUSA_API_URL` | Medusa Admin URL |
| `MEDUSA_API_KEY` | Medusa secret API key |
| `MEDUSA_MEMBERSHIP_GROUP_ID` | (선택) 멤버십 가격 동기화 시 |
| `SKIP_ATTACH_CATEGORY_IDS` | (선택) attach 제외할 PIM 카테고리 ID 목록 (콤마 구분) |
| `SKIP_ATTACH_CATEGORY_SLUGS` | (선택) attach 제외할 카테고리 slug 목록 (콤마 구분) |

## 실행 흐름

```bash
export CORE_DB_URL=postgres://...core-db...
export DATABASE_URL=postgres://...channel-adapter-db...
export MEDUSA_API_URL=...
export MEDUSA_API_KEY=...

# 1. 카테고리 prefill — 부모→자식 순으로 Medusa 에 카테고리 적재
npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/prefill-medusa-categories.ts

# 2. 표본 스모크 (10~20건으로 안전 확인)
# 둘 중 어느 형식이든 가능 (npm alias 호환):
#   npm run migrate:backfill:limit -- 20            # alias 가 끝에 --limit 을 붙여줌 → '--limit 20'
#   npm run migrate:backfill -- --limit=20          # 직접 지정
# (직접 ts-node 호출:)
npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --limit=20 --concurrency=1

# 3. 본 백필 (default concurrency=3, 최대 10)
npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --concurrency=3

# 4. 검증
npx ts-node apps/channel-adapter/scripts/verify-migration.ts --detailed

# 5. 실패 재시도 (있다면)
npx ts-node apps/channel-adapter/scripts/retry-failed.ts --session=<sessionId>
```

## backfill-v2 옵션

| 플래그 | 기본 | 설명 |
|--------|------|------|
| `--batch-size=N` | 100 | 배치당 가져올 마스터 수 |
| `--concurrency=N` | 3 (max 10) | 청크 내 병렬 동기화 수. Medusa Admin/RDS 부담을 봐가며 조정 |
| `--rate-limit-ms=N` | 1000 | 배치 사이 sleep. 0 이면 sleep 안 함 |
| `--limit=N` | 무제한 | 총 처리 상품 수 제한 (스모크용) |
| `--resume=<sessionId>` | — | 체크포인트에서 재개 |

## 캐시 prime 동작

`backfill-v2.ts` 진입 시 `medusaClient.primeAll()` 이 다음을 모두 사전 적재합니다:
- 카테고리 (handle / metadata.pimCategoryId / metadata.pimSlug 키)
- 태그 (value 키)
- 상품 타입 (value 키)
- 세일즈 채널 (name 키)

이후 `enableCacheOnlyCategoryLookup(true)` 가 켜져 paginated LIST 조회를 우회. 신규 항목은 cache miss 로 정상 create 경로 진입.
런타임 InboxWorker 경로는 prime 을 호출하지 않으므로 평소 동작에 영향 없음.

## 스크립트 목록

| 스크립트 | 용도 |
|----------|------|
| `backfill-v2.ts` | 메인 백필. checkpoint 기반 세션, 자동 재시도, 카테고리/태그 캐시 prime 통합 |
| `prefill-medusa-categories.ts` | 백필 직전에 Core 카테고리 트리를 Medusa 에 선행 동기화 |
| `verify-migration.ts` | Core active master 수 vs Channel Adapter `pim_medusa_mappings` 카운트 비교 |
| `retry-failed.ts` | `migration_failures` 의 실패 건 재시도 |
| `check-progress.ts` | 진행 중/완료된 세션 상태 조회 |
| `lib/` | snapshot builder, session service, error classifier |
| `legacy/` | v1 백필 잔재. 사용 중지 — `legacy/README.md` 참조 |
| `migrate-outbox-to-inbox.sql` | `outbox_events` → `inbox_events` 테이블/인덱스 일회성 rename |
