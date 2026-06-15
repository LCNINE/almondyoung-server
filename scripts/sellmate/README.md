# 셀메이트 → core 재고상품/재고 마이그레이션

셀메이트의 재고상품·재고량을 core(inventory)로 옮기는 스크립트 모음.

## 개념 매핑

| 셀메이트 | core | 비고 |
|----------|------|------|
| 상품(옵션 있음) | `sku_group` | code=상품코드(없으면 `sm-{상품일련번호}`), name=상품명 |
| 품목(옵션) | `sku` | code=**옵션정보일련번호**, option_key=옵션명, group_id=그룹 |
| 상품(옵션 없음) | `sku` 1개 | 그룹 없이 단독 SKU |
| 현재재고 | `stock_events` + `stock_ledgers` | 부천 물류창고 ON_HAND |

- **SKU 고유키 = 옵션정보일련번호**. (옵션코드는 비어있는 경우가 많아 부적합. 단일상품 포함 모든 품목에 존재하는 옵션정보일련번호를 키로 사용.)
- **옵션 묶음 키 = 상품일련번호** (상품코드가 비어있는 행이 있어 itemCode 로 대체하면 옵션이 제각각 분리됨).
  상품코드가 있으면 그룹 code 로 그대로 쓰고, 없으면 `sm-{상품일련번호}` 합성 코드를 쓴다. 둘 다 비면 오류로 중단.
- 옵션 여부는 **파일 간 dedup(옵션정보일련번호 기준) 후의 고유 품목 수 > 1 또는 옵션명 존재** 로 판정.
  (dedup 전에 판정하면 같은 파일 중복이 단일상품을 옵션상품으로 둔갑시킴.)
- 셀메이트는 옵션 없는 상품의 옵션명을 `단일상품` 으로 채움 → 옵션 없음으로 처리.
- **재고매칭(SKU↔변형)은 범위 밖** (일괄 반입 불가, 추후 수동). 매칭 전이라 sellable 재발행은 생략하지만,
  매칭 후 sync 를 돌려 매칭된 SKU 재고가 바뀌면 sync 가 경고+exit 2 로 알린다(별도 재계산 필요).

## 입력 파일 받기 (셀메이트)

1. `재고관리 > 재고 상품 관리 > 재고 현황 목록`
2. `상품등록일자` 를 **임의기간**으로 분기 설정 (예: `2026-01-01 ~ 2026-03-31`) → 검색
   - 한 번에 전체가 실패하면 분기를, 그래도 실패하면 1개월 단위로 쪼개서 반복
3. `엑셀 다운로드 > 검색결과 전체 다운로드` → 양식 **`개발팀 데이터 내보내기용`** (또는 기본 양식)
4. 대기열에서 생성 완료되면 다운로드 (`.xls`, 실제로는 HTML+EUC-KR — 스크립트가 그대로 읽음)
5. 받은 파일들을 `apps/core/tmp/` 에 모아둠 (여러 분기 파일 한꺼번에 처리 가능)

## 실행

> **DATABASE_URL** = core 논리 DB. dev 는 sst tunnel 후 `postgres://postgres:<pw>@localhost:<port>/core`.
> 반드시 **dev + DRY_RUN 으로 먼저** 검증한 뒤 실제 반영.

### 1) 재고상품 임포트 (SKU/그룹 생성, 재실행 안전)

```bash
# 헤더 감지 + 파싱 미리보기 (DB 안 건드림)
DRY_RUN=1 npx tsx scripts/sellmate/import-products.ts apps/core/tmp/

# 실제 반영
DATABASE_URL=postgres://... npx tsx scripts/sellmate/import-products.ts apps/core/tmp/
```

### 2) 재고량 동기화 (현재고를 셀메이트 값에 맞춤, 언제든 반복)

```bash
# 어떤 품목을 얼마나 +/- 할지 미리보기
DATABASE_URL=postgres://... DRY_RUN=1 npx tsx scripts/sellmate/sync-stock.ts apps/core/tmp/

# 실제 반영 (import 먼저 돌려 SKU 가 존재해야 함)
DATABASE_URL=postgres://... npx tsx scripts/sellmate/sync-stock.ts apps/core/tmp/
```

## 재실행/idempotency · 무결성

- **원자성**: import / sync 모두 전체를 단일 트랜잭션으로 처리 → 중간 실패 시 전부 롤백(부분 반영 없음).
- **import**: code(상품/옵션정보일련번호) 기준 upsert → 같은 파일 여러 번, 추가분만 반영. 바코드는 빈값을
  위조하지 않고, 다른 SKU 가 점유한 바코드는 충돌로 보고만 한다(SKU당 primary 하나 유지).
- **sync**: 목표재고 - 현재고 = delta 만큼만 조정 → delta=0 이면 no-op. 같은 파일 다시 돌려도 안전.
  advisory lock + 트랜잭션 내 FOR UPDATE 재읽기로 동시 실행/운영 변경과의 경합을 막는다.
- **엄격 검증(sync)**: 재고 값이 비음수 정수가 아니면 중단(0 추정 금지). core 에 없는 품목이 있으면 기본 중단
  (`ALLOW_MISSING=1` 로 부분 반영). 여러 파일에 같은 품목이 다른 재고로 있으면 중단(`ALLOW_DUP_FILES=1`).

## 자동감지가 틀릴 때 (양식 바뀐 경우)

환경변수로 헤더 이름을 직접 지정:
`COL_PRODUCT_CODE`, `COL_PRODUCT_SERIAL`, `COL_PRODUCT_NAME`, `COL_ITEM_CODE`, `COL_OPTION_NAME`, `COL_BARCODE` (import) /
`COL_ITEM_CODE`, `COL_STOCK` (sync). 인코딩은 `SELLMATE_ENCODING` (기본 euc-kr).

## 매칭 이후 (추후)

재고매칭을 붙인 뒤에는 SKU별 `recalculateAndPublishForSku` 를 한 번 돌려야 sellable 수량이
스토어프론트/Medusa 로 발행됨. (이 스크립트들은 매칭 전 단계 전용.)
