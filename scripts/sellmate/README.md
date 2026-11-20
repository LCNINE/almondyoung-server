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

## 주문 이력 → 수요 시계열 시드 (`import-demand-history.ts`, #743)

셀메이트 주문/판매 export(옵션정보일련번호 · 주문일 · 수량 · 금액)를 core `sku_demand_daily` 에 `source='sellmate'` 로 넣는다.
보충 제안의 수요 프로필이 이걸 읽는다. `replenishment_settings.demand_core_since`(D0) **이전** 날짜만 시드하고,
D0 가 비어 있으면 `--core-since` 또는 core 최초 주문일로 설정한다(이미 있으면 덮어쓰지 않음).

```bash
DRY_RUN=1 bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/          # 파싱 · 매칭 · 미매칭 리포트만
bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/ --core-since 2026-07-01
```

- 미매칭 품목은 중단하지 않고 `apps/core/tmp/demand-unmatched-<ts>.csv` 로 남긴다.
- 헤더가 다르면 `COL_ITEM_CODE` / `COL_ORDER_DATE` / `COL_QTY` / `COL_AMOUNT` 로 지정.
- 시드 뒤 `POST /replenishment/profiles/recompute?series=full` 로 프로필을 다시 만든다.

## 선반 위치 적재 (`load-shelf-positions.ts`)

셀메이트 재고 백업 CSV 의 `상품위치`(+`대표이미지주소`)를 core `sku_shelf_positions` 에 넣는다 (실측 작업의 선반 조회용).
`옵션정보일련번호` 로 `skus.code` 와 맞추고, 위치는 앞뒤 공백 제거 + 대문자화한다. 위치가 빈 행은 건너뛴다.
이 스크립트는 `sku_shelf_positions` 만 건드리며 sku_id 기준 upsert 라 다시 돌려도 안전하다. 매칭 안 된 SKU 코드 수를 출력한다.

```bash
DRY_RUN=1 npx tsx scripts/sellmate/load-shelf-positions.ts ~/다운로드/01_현재고_전체_YYYYMMDD.csv   # 먼저 통계만
DATABASE_URL=postgres://... npx tsx scripts/sellmate/load-shelf-positions.ts <csv>                 # 반영 (마이그 적용 뒤)
```

## 로케이션 마스터 만들기 (`build-location-master.ts`, #1235)

`sku_shelf_positions` 의 선반 코드로 판매 창고에 열·랙·칸(standard 로케이션)을 만든다. 창고 자석 라벨의 바코드 값이
셀메이트 위치 코드와 같아서, 만든 로케이션을 적치 화면이 스캔으로 바로 잡는다.

- 기본은 dry-run(실제로 만들어 보고 되돌림). `--apply` 로 반영. 늘리기만 하고 지우지 않으며 다시 돌려도 안전하다.
- 랙은 데이터에 나온 것만, 칸은 1번부터 그 랙의 가장 큰 칸까지 전부. 모자란 칸은 `PUT /inventory/locations/racks/:rackId` 로 끝 번호를 올리면 생긴다.
- `CC-4-1`·`O21-30-` 같은 텍스트는 바른 코드로 고쳐 읽고(`apps/core/src/modules/inventory/core/shelf-code-reading.ts`), 꼴에 안 맞는 텍스트는 «사람이 정할 예외»로 찍기만 한다.

```bash
bash scripts/sellmate/run.sh live build-location-master            # dry-run
bash scripts/sellmate/run.sh live build-location-master --apply    # 반영
```

## 컷오버: 입고기본존 재고를 선반으로 (`move-stock-to-shelf.ts`, #1236)

**T 당일, 마지막 `sync-stock`·`load-shelf-positions` 직후에 한 번만.** 셀메이트 위치 텍스트가 선반 로케이션 하나로 읽히는 SKU 의
입고기본존 재고를 그 선반으로 MOVE(원장 이벤트)한다. 나머지는 사유와 함께 CSV 로 남겨 컷오버 뒤 실사 대상이 된다.

- 판정은 `apps/core/src/modules/inventory/core/shelf-move-verdict.ts`(컷오버 판정 «로케이션 2» 와 같은 함수). 남기는 사유: 위치 없음·낡은 위치 행·못 읽는 텍스트·고쳐 읽은 코드(스위치 꺼짐)·로케이션 없음·다른 선반에 재고·배정 걸림·적치 대기·불일치.
- `--positions-since` 는 T 당일 `load-shelf-positions` 를 돌리기 **직전** 시각이다. 그보다 앞서 쓰인 위치 행은 셀메이트에서 지워졌을 수 있어 믿지 않는다(적재는 지우지 않는다).
- 고쳐 읽은 코드(`CC-4-1` → `CC-04-01` 등)는 현장 확인 전까지 꺼져 있다. `--include-rule=zero-pad,dash-position,custom-bin` 로 규칙마다 켠다.
- 며칠 뒤 다시 돌리지 않는다 — 묶이지 않은 앱 입고분까지 쓸어 간다.

```bash
bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<시각>            # dry-run
bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<시각> --apply    # 반영
# 판매 창고가 둘 이상이면 --warehouse-id=<부천 창고 id> 를 붙인다
# 동시 처리 기본 4(--concurrency). 11-18 라이브에서 8·16 은 sst 터널을 죽였다. 4 로 dry-run 약 3분, apply 는 그보다 몇 배 길다
```

## 바코드번호2 백필 (`backfill-barcode2.ts`, #1356)

셀메이트 «현재고 전체» CSV 의 `바코드번호2` 를 이미 적재된 SKU 에 보조 바코드(`is_primary=false`)로 넣는다.
T 부터 스캔은 core 가 `sku_barcodes` 에서 찾으므로, 셀메이트에서 스캔되던 바코드번호2 가 없으면 «모르는 바코드»가 된다.
새로 가져오는 SKU 는 `import-products` 가 같은 규칙(`barcode2-plan.ts`)으로 함께 넣는다.

- 보조 바코드만 넣는다. SKU·그룹·대표 바코드는 건드리지 않는다. 대표 바코드와 같은 값·빈 값은 건너뛴다.
- 이미 같은 SKU 에 달린 값(대표든 보조든)은 그대로 두고, 다른 SKU 가 쓰는 값은 넣지 않고 충돌로 보고한다. 같은 값을 다른 품목의 대표가 원하면 대표가 이긴다.
- 출력: 넣을 것 / 이미 같은 SKU / 충돌 / core 에 SKU 없음. 넣을 것·충돌에는 재고 있는 SKU 수를 붙인다.
- 기본은 dry-run(읽기 전용 트랜잭션). `--apply` 로 반영. 다시 돌려도 안전하다. 셀메이트는 테넌트 1 의 것이라 기본 `DB_NAME=core` 에만 돈다.
- **`--apply` 직전에 «현재고 전체» 를 다시 받는다** — 받은 뒤에 생긴 SKU 는 파일에 없어 빠진다.
- 끝: 다시 돌린 dry-run 의 «core 에 넣을 것» 이 0. 충돌 목록은 사람이 정한다. 그 다음 아래 `register-missing-barcodes` 를 돌린다.

```bash
DRY_RUN=1 bash scripts/sellmate/run.sh live backfill-barcode2 ~/다운로드/01_현재고_전체_YYYYMMDD.csv           # dry-run
bash scripts/sellmate/run.sh live backfill-barcode2 ~/다운로드/01_현재고_전체_YYYYMMDD.csv --apply              # 반영
```

## 바코드 없는 SKU 에 SKU 코드 등록 (`register-missing-barcodes.ts`, #1281)

`sku_barcodes` 행이 하나도 없는 SKU 에 `skus.code` 를 대표 바코드(`is_primary`)로 넣는다. 스테이션 SKU 라벨이 바코드 없이 찍히지 않게 하는 일회성 보충이다.
**#1356 백필(`backfill-barcode2`, 위) 뒤에** 돌린다(백필이 채울 수 있는 SKU 를 먼저 채워야 이 스크립트가 건드릴 SKU 가 줄어든다). 항상 dry-run 으로 먼저 본다.

- 기본은 dry-run(읽기 전용 트랜잭션). `--apply` 로 반영. 이미 바코드가 있는 SKU 는 건드리지 않고, 그 코드를 다른 SKU 가 쓰면 넣지 않고 충돌로 보고한다. 다시 돌려도 안전하다.
- 등록 대상 SKU 코드 목록을 출력하고 재고(`stock_ledgers.qty` 합)가 있는 SKU 는 ★ 로 먼저 보인다 — T 전에 스티커를 뽑을 대상이다. dry-run 에서도 같은 목록이 나온다.
- core 는 테넌트마다 논리 DB 가 따로라 다른 셀메이트 스크립트와 같게 테넌트 DB 마다 한 번씩 돈다(`run.sh` 의 `DB_NAME`).

```bash
bash scripts/sellmate/run.sh live register-missing-barcodes            # dry-run
bash scripts/sellmate/run.sh live register-missing-barcodes --apply    # 반영
```

## 저녁 맞추기 (`evening-reconcile.ts`, #1304)

T(컷오버) 뒤 매일 저녁, 셀메이트 쪽 변화(마켓 주문·취소·반품)를 core 원장으로 가져오고 core 가용을 셀메이트 «재고 수정» 업로드 CSV 로 돌려보낸다.
규칙·근거는 `docs/superpowers/specs/2026-11-17-sellmate-evening-reconcile-design.md`.

> **T 전에 live `db:migrate` 필요** (`20261116154029_add-sellmate-reconcile-tables`). 앱 배포는 필요 없다.
> `sync-stock` 은 DRY_RUN 이어도 `DATABASE_URL` 이 필요하다(`run.sh` 가 넣는다). `init` 뒤에는 `sync-stock`·`handover-stock-addback` 이 거절한다.

### 하위 명령 (모두 dry-run 이 기본, `--apply` 일 때만 쓴다)

| 명령 | 하는 일 |
|---|---|
| `pair <재고 CSV>` | 셀메이트 품목 ↔ core SKU 짝 표를 다시 쓴다(원장 안 건드림). 짝 못 지은 품목이 있으면 종료 코드 1 |
| `init <마지막 sync 재고 CSV> --cutover-at=<T> --sellmate-orders=<T 의 미발송 주문 파일> --own-mall-channel=<자사몰 판매처 이름>` | T 에 한 번. 기준값·이월·넘긴 주문을 쓴다(원장은 안 씀). `MEDUSA_DATABASE_URL` 필요 → `WITH_MEDUSA=1`. 부천 ON_HAND 가 `max(0, 현재재고 − 미발송)` 과 다른 품목이 있거나 넘긴 자사몰 주문이 0건이면 거절 — 확인했으면 `--accept-onhand-mismatch`·`--no-handed-over-orders` |
| `apply <지금 받은 재고 CSV>` | 원장 반영 + 회차(업로드 대기) + 업로드 CSV(`<OUT_DIR>/sellmate-reconcile-<회차>-upload.csv`) |
| `close <업로드 뒤 다시 받은 재고 CSV> [--accept-landed=<옵션,…>] [--accept-not-landed=<옵션,…>]` | 업로드가 먹었는지 판정하고 기준값을 확정한다. ✗ 가 있으면 1 (`--apply` 면 고친 CSV `…-fix.csv` 를 쓴다) |
| `status` | 열린 회차·이월·짝 못 지은 품목(읽기 전용) |

`OUT_DIR`(기본 `apps/core/tmp`), `UPLOAD_ENCODING`(기본 euc-kr), `COL_*`(열 이름 덮기) 환경변수를 쓴다.

### 매일 절차

```bash
# 1. 셀메이트에서 재고 현황 CSV 받기 → apps/core/tmp/
# 2. 미리보기 → 반영 (업로드 CSV 가 만들어진다)
bash scripts/sellmate/run.sh live evening-reconcile apply apps/core/tmp/<받은 CSV>
bash scripts/sellmate/run.sh live evening-reconcile apply apps/core/tmp/<받은 CSV> --apply
# 3. 업로드 CSV 를 셀메이트 «재고 수정» 에 올린다
# 4. 셀메이트에서 재고 현황 CSV 를 «다시» 받는다 (새 파일)
# 5. 판정 → 확정
bash scripts/sellmate/run.sh live evening-reconcile close apps/core/tmp/<다시 받은 CSV>
bash scripts/sellmate/run.sh live evening-reconcile close apps/core/tmp/<다시 받은 CSV> --apply
```

### 운영 규칙

- 맞추는 동안(받기 → 업로드 → 다시 받기) 셀메이트 출고·반품 입고를 멈춘다. 셀메이트에서 재고를 손으로 고치지 않는다.
- 같은 CSV 로 `apply` 를 두 번 반영할 수 없다(거절).
- `close` 가 실패한 시도에 쓴 CSV 는 다시 쓸 수 없다. 새로 받은 CSV 로 다시 한다.
- `close` 가 `shipped_before_upload(업로드 전 출고 또는 마켓 취소)` 를 띄우면 셀메이트 주문 목록에서 확인한다:
  - 출고였으면 `--apply` 가 쓴 `…-fix.csv` 를 올리고 재고 현황을 다시 받아 `close`.
  - 취소였으면 fix 를 올리지 말고 새로 받은 CSV 로 `close --accept-landed=<품목>` (취소분은 다음 `apply` 가 core 에 더한다).
- 고친 파일(fix)을 만든 품목은 그 회차가 닫힐 때까지 «현재만 늘었다» 를 반품으로 받아들이지 않는다 — 지목(`--accept-landed`/`--accept-not-landed`)해야 넘어간다. 같은 품목을 둘 다에 지목하면 거절.
- 닫힌 회차의 업로드·fix 파일은 다시 올리지 않는다(셀메이트를 옛 숫자로 덮는다).
- 새 품목·동결 해제 품목은 같은 `apply` 안에서 셀메이트 미발송분을 core 에서 차감한다.
- 짝 못 지은 품목·CSV 에서 사라진 품목·SKU 가 바뀐 품목이 있으면 `init`·`apply` 는 쓰지 않고 종료 코드 1. 짝 표도 안 쓰므로, 판정(cutover-preflight)이 보게 같은 CSV 로 `pair --apply` 를 돌려 둔다.
- 제외 품목(`excluded.ts`)과 바코드가 같은 품목은 `barcode_shared` 로 짝 못 지은 품목이 된다(올리면 제외 품목 재고를 덮는다).
- `apply --apply` 뒤 sellable 재계산이 실패하면 원장은 이미 커밋된 것이다 — `apply` 를 다시 돌리지 말고 24시간 안에
  `bash scripts/sellmate/run.sh live recalc-sellable .` 를 돌린다.

### 첫 live `--apply` 전에 사람이 확인할 것

- [x] 재고 수정 업로드가 **바코드번호 1~3·글로벌바코드 중 어느 것**과 맞추는지 — 2026-11-19 라이브 시험: **바코드번호(숫자, 재고 CSV 의 `바코드번호(서식)` 값)** 로 맞추고 바코드번호2 는 «찾을 수 없습니다». 업로드 CSV 가 이미 그 값을 쓰므로 `COL_*` 는 그대로(바코드번호3·글로벌바코드는 시험 못 함). 절차·화면은 컷오버 런북 `docs/runbooks/sellmate-cutover-phase1.md` §1.
- [x] 마켓에 보내는 숫자에 **안정재고**가 끼는지 — 2026-11-19 운영자 확인: 끼지 않는다(셀메이트 안의 발주용 필터 값). `U` 그대로.
- [x] 셀메이트 미발송 주문 목록 export 에 **판매처와 주문번호** 열이 있는지 — 기본 양식의 `판매처명`·`판매처주문번호`. «추가주문생성» 주문의 `셀-…-NN` 번호는 원 주문 번호로 읽는다. 파일은 비밀번호가 걸려 받아진다 — 두 열만 뽑아 넘긴다(런북 §3).
- [x] 재고 현황 CSV 양식에 바코드 열이 있는지 — «개발팀 데이터 내보내기용» 에 있다. 이 양식의 상품별 `합계` 행은 파서가 건너뛴다.

컷오버 사전 점검(`scripts/ops/cutover-preflight/index.ts`)의 «재고 1. 저녁 맞추기» 절(`checks/reconcile.ts`)이 본다.
