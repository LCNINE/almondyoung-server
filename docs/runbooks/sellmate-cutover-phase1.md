# 셀메이트 컷오버 1단계 런북 (#1251)

> 상위: #1233(1단계 지도). 순서의 뼈대는 설계 문서 [`2026-11-11-cutover-phase1-core-stock-owner-design.md`](https://github.com/LCNINE/almondyoung-server/blob/docs/cutover-phase1-core-stock-owner/docs/superpowers/specs/2026-11-11-cutover-phase1-core-stock-owner-design.md) «컷오버 당일»이고, 이 문서는 그 순서를 당일 따라 할 수 있게 명령·판정·실패 시 할 일로 풀었다.
>
> ⚠️ **당일엔 이 문서를 따른다 — 설계 문서 «컷오버 당일» 은 그 뒤 결정으로 바뀐 곳이 있다.** 설계 문서 4번의 «드레인 끝에 `close-shipped-shipments`» 는 #1243 이 **`close-sellmate-leftovers`** 로 바꿨다 — T 뒤 `close-shipped-shipments` 단독 실행은 금지다(§4-5·§7). 2번에는 #1247(`clear-reservations` 뒤 투영 T 설정)·#1304(`evening-reconcile init`)·#1412(출고 준비 화면은 init 뒤)가 더해졌다(§4·§6). 순서의 최신판은 #1233 «당일 순서» 다.
> 1단계 = 자사몰(Medusa) 주문은 창고 앱, core 가 재고 정본. 마켓(네이버·쿠팡) 주문은 1단계 내내 셀메이트가 처리한다. 마켓 채널을 켜는 시각은 2단계(#1306) 런북이 다룬다.
> 코드·데이터에서 나오는 숫자는 적지 않는다 — 판정 스크립트(§0-2)를 돌려서 본다.

## 0. 이 문서를 읽는 법

### 0-1. 표시

| 표시 | 뜻 |
|---|---|
| ⛔ | **되돌릴 수 없다.** 돌리기 전에 앞 단계의 판정이 초록인지 다시 본다 |
| 🔍 → ✅ | 미리보기(dry-run)를 먼저 보고, 결과가 맞을 때만 `--apply` 를 붙인다 |
| 판정 | 그 단계가 끝났다는 증거. «완료» 로그는 증거가 아니다 |
| 실패 시 | 그 단계에서 멈췄을 때 할 일 |

빈칸: `<T>` 는 컷오버 시각(KST 오프셋을 붙인 ISO, 예 `2026-12-01T09:00:00+09:00`), `<T-날짜>` 는 그날 날짜, `<창고 id>`·`<공유 이름>`·`<실행 id>` 는 리허설에서 정해 적는다.

**T 는 하나다.** 같은 값을 `set-reservation-cutover --at`, `evening-reconcile init --cutover-at`, 판정의 `--after-cutover` 에 쓴다. 정하는 법은 §3.

### 0-2. 판정 스크립트 (축 0)

읽기 전용이다 — 아무것도 고치지 않는다. ✗ 마다 무엇이 고치는지(이슈·명령)를 함께 찍는다. 두 셸에서 돌린다.

```bash
# 터널이 떠 있어야 한다(§2). AWS_PROFILE 은 export 하지 않는다
cd deployments/lcnine/services && npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/index.ts
cd deployments/lcnine/auth     && npx sst shell --stage live -- npx tsx ../../../scripts/ops/cutover-preflight/index.ts
# T 뒤에는 둘 다 끝에 --after-cutover=<T>
```

- 종료 0 = ✗ 없음(◆·◇ 만 남음). 1 = ✗ 있음. 2 = DB 에 못 닿음(터널·로그인부터 본다).
- ◆ «당일 처리» = 일부러 당일에 고치는 항목. T 전에는 실패로 세지 않고, `--after-cutover` 를 붙이면 남은 ◆ 가 ✗ 가 된다.
- ◇ «2단계» = 마켓 통합 항목. 보여 주기만 한다.
- 이 문서가 «판정 «출고 4»» 처럼 부르는 이름은 출력의 절 제목(`출고 4. 예약 — …`)이다.

### 0-3. 사람

| 누구 | 하는 일 |
|---|---|
| 개발자(운영자) | 터널·스크립트·판정. 저녁 맞추기도 개발자가 돌린다(설계 결정) |
| 매일 셀메이트 스크립트를 돌리던 사람 | `collect-cellmate`·`mark-*` 의 마지막 실행(늘 하던 방식으로) |
| 물류팀 | 셀메이트 데이터 받기·업로드, 맞추는 동안 셀메이트 작업 멈춤, 스테이션 출고 |

---

## 1. 전날까지

**판정:** §0-2 두 셸 모두 종료 0(1단계 항목에 ✗ 없음). ◆ 는 남아도 된다 — 당일 지운다.

아래는 판정이 다 못 보는 사람 일이다.

- [ ] **T 전에 라이브여야 하는 변경이 라이브인지** — 판정 «Medusa 0. 예약 투영»(#1247), 드레인 중 셀메이트 상자 거절(#1412, core), 저녁 맞추기 테이블(#1304, live `db:migrate` 만), 멈춘 송장 abandon 화면(#1241), 라벨 출력(#1281). 배포 기록은 `deploy/live/*` 태그로 본다(`npm run deploy:preflight -- --stage live` 의 대기 마이그 0).
- [ ] **저녁 맞추기 «첫 live `--apply` 전에 사람이 확인할 것»**(#1304, `scripts/sellmate/README.md` 같은 절) 네 개:
  - [ ] 재고 수정 업로드가 바코드번호 1~3·글로벌바코드 중 무엇과 맞추는지 — 시험 상품 1개 값을 바꿔 올리고 되돌려 본다. 결과대로 `COL_*` 를 정한다
  - [ ] 마켓에 보내는 숫자에 안정재고가 끼는지 — 끼면 `U` 정의를 고친 뒤 간다
  - [ ] 셀메이트 미발송 주문 export 에 판매처·주문번호 열이 있고, 자사몰 주문번호가 `YYYYMMDD-display_id` 꼴인지 — `init --sellmate-orders` 가 이 파일을 읽는다
  - [ ] 재고 현황 CSV 양식에 바코드 열이 있는지 — 없으면 «개발팀 데이터 내보내기용» 양식에 더한다
  - [ ] ⚠️ 옵션정보일련번호가 빈데 값이 있는 행이 있으면 파일 전체를 거절한다 — 실제 export 로 dry-run 해 본다
- [ ] **짝 표:** 🔍 `bash scripts/sellmate/run.sh live evening-reconcile pair <재고 CSV>` → ✅ `--apply`. 종료 0 이 될 때까지 짝 못 지은 품목을 고친다. 판정 «재고 1. 저녁 맞추기» 가 이 표를 본다.
- [ ] **바코드번호2 백필**(#1356, PR #1371). 터널 필요.
  1. 🔍 `DRY_RUN=1 bash scripts/sellmate/run.sh live backfill-barcode2 <현재고 전체 CSV>` — 넣을 것·충돌을 본다
  2. **«현재고 전체» 를 다시 받아서** ✅ `bash scripts/sellmate/run.sh live backfill-barcode2 <새 CSV> --apply` (받은 뒤 생긴 SKU 는 파일에 없어 빠진다)
  3. 판정: 같은 CSV 로 다시 dry-run → «core 에 넣을 것» 0. 충돌 목록은 사람이 정한다
  4. 그 다음 🔍 `bash scripts/sellmate/run.sh live register-missing-barcodes` → ✅ `--apply`. ★(재고 있는 SKU)는 T 전에 스티커를 뽑는다
  - T 까지 새로 생기는 SKU 는 T 의 `import-products` 가 같은 규칙으로 보조 바코드를 넣는다.
- [ ] **#1236 의 남은 확인:** DD 열에 `exact` 로 맞는 위치가 있으면 기본으로 옮겨진다 — 라이브에서 센다(현장 확인 기록은 PR #1424, 머지 전).
- [ ] **실무자 양해:** T 부터 셀메이트에 입고예정·입고·재고 조정을 넣지 않는다. 셀메이트에서는 마켓 주문의 출고·반품·교환만 한다. 재고 조정·실사는 core(앱)에서 한다.
- [ ] **맞추기 시간 운영 규칙 공지**(§8-1): 저녁 맞추기 동안 셀메이트 출고·반품 입고를 멈춘다.
- [ ] **비상 출고 사전 준비**(§10-1) — 리허설 때 끝내 둔다.
- [ ] **리허설**(§11)을 이 문서만 보고 끝까지 갔다.

**실패 시:** 판정 ✗ 는 그 줄이 적은 이슈·명령으로 고친다. 1단계 ✗ 가 남으면 T 를 미룬다.

---

## 2. 당일 아침 준비

- [ ] **AWS 로그인 갱신:** `aws login --profile login`. 세션은 12시간이 상한이다 — 저녁 맞추기(§8)까지 이어지게 아침에 새로 받고, 오후에 한 번 더 받는다. 스크립트가 `credential_process` 254 로 죽으면 로그인부터 다시 받고 같은 명령을 다시 돌린다.
- [ ] **터널(별도 창, 유지):** `cd deployments/lcnine/services && npx sst tunnel --stage live` (sudo). 사람이 띄운다. 「Tunnel listening…」 을 본다.
- [ ] **판정 한 번:** §0-2 두 셸. 어제 초록이 오늘도 초록인지.
- [ ] **막혔을 때:** 「이 상자가 왜 안 열리나」는 먼저 어드민 «출고 정체 보드»(`/order/stall-board`)와 출고주문 상세(`/order/fulfillments`)로 본다. 거기서 안 풀리면 개발자가 Claude 에게 라이브 DB 를 읽게 한다 — 시작점은 §12.
- [ ] **작업 폴더:** 오늘 받을 셀메이트 파일을 모을 폴더(`apps/core/tmp/`)를 비우거나 날짜 폴더로 나눈다 — `sync-stock` 은 폴더 안 파일을 전부 읽는다.

---

## 3. 시각 T — 마지막 데이터 받기

1. **`collect-cellmate` 마지막 실행.** 매일 돌리던 사람이 늘 하던 방식(`scripts/ops/cellmate-local/README.md`)으로 돌리고, 나온 파일을 셀메이트에 올린다. **이 뒤로는 돌리지 않는다.** 이 뒤에 들어온 자사몰 주문은 앱 몫이다.
2. 셀메이트 화면에서 바로 이어서 받는다(`docs/runbooks/feature-admin-web-merge.md` §4-1, `scripts/sellmate/README.md` «입력 파일 받기»):
   - [ ] **재고 현황 CSV** — `상품코드(카페)`·`미발송주문수`·`상품위치` 열 포함. 이 파일이 마지막 `sync-stock`·`load-shelf-positions`·`init` 의 입력이다
   - [ ] **현재고 전체 CSV** — 바코드번호2 가 든 양식(필요하면 백필을 한 번 더)
   - [ ] **상품목록 엑셀**(상품관리 > 상품목록, `공급처`·`원가`·`바코드번호(서식)` 포함)
   - [ ] **미발송 주문 목록** — `init --sellmate-orders` 의 입력. 판매처·주문번호 열
   - [ ] **주문이력** — 보충 제안 수요(`import-demand-history`)를 나중에 메울 원본
3. **T 를 정한다.** T = 재고 현황 CSV 의 스냅샷 시각(파일명에서 `clear-reservations` 가 읽는 기준 시각) **이상**. 그보다 이르면 [T, 기준 시각) 주문의 Medusa 예약이 지워진 뒤 투영이 다시 만들어 이중 차감된다(`selmate-stock-pipeline.md` Ⓑ «컷오버 당일 순서 중 Medusa 예약 두 줄»). 적어 둔다: `<T>`.

**판정:** 파일 다섯 개가 다 있고, 미발송 주문 목록에 자사몰 판매처 행이 있다.

**실패 시:** 셀메이트 export 가 실패하면 분기·월 단위로 쪼개 받는다(`scripts/sellmate/README.md`). 재고 CSV 를 못 받으면 §4 로 가지 않는다 — T 를 미룬다. 1번 이후 §4 까지 시간이 길어지면 그 사이 자사몰 주문이 셀메이트에도 앱에도 안 잡힌다 — §3 과 §4 는 붙여서 한다.

---

## 4. 마지막 동기화 ⛔ 되돌릴 수 없음

> ### ⛔ 여기부터 되돌릴 수 없다
> `sync-stock` 은 **절대값**이다. T 뒤에 **한 번이라도** 더 돌면 셀메이트 숫자로 core 원장(앱 입고·출고)을 덮어 되돌린다.
> 이 절의 `sync-stock` 이 **마지막**이고, 4-4 의 `init --apply` 뒤에는 스크립트가 스스로 거절한다(`init` 이 남기는 가드).
> 4-4 전에 멈추면 아직 되돌릴 수 있다(다음 날 다시 시작). 4-4 뒤에 멈추면 앞으로만 간다.

순서는 `selmate-stock-pipeline.md` «전체 그림» 그대로다: Ⓑ → Ⓐ → Ⓔ → Ⓕ. 모든 명령은 저장소 루트, 터널 필요.

### 4-1. Ⓑ Medusa 예약 정리 → 투영 T 설정 (#1247)

```bash
DB_NAME=medusa bash scripts/sellmate/run.sh live clear-reservations <재고 CSV>            # 🔍
DB_NAME=medusa bash scripts/sellmate/run.sh live clear-reservations <재고 CSV> --apply    # ✅ 마지막
```

판정: `selmate-stock-pipeline.md` Ⓑ «끝나고 반드시 확인한다» 의 두 쿼리(raw 드리프트 0, store API 값). 그 다음 바로 투영의 T 를 설정한다(channel_adapter DB):

```bash
cd deployments/lcnine/services && npx sst shell --stage live -- bash -c '
  export DATABASE_URL=$(node -e "const d=JSON.parse(process.env.SST_RESOURCE_Db);console.log(\`postgresql://\${d.username}:\${encodeURIComponent(d.password)}@\${d.host}:\${d.port}/channel_adapter?sslmode=require\`)")
  npx tsx ../../../apps/channel-adapter/scripts/set-reservation-cutover.ts --at <T>'            # 🔍 지금 값·바꿀 값
# ✅ 같은 명령 끝에 --apply --by <이름>
```

- `--at` 은 오프셋 없는 시각을 거절한다(9시간 어긋남 방지).
- T 가 설정되면 `clear-reservations --apply` 는 스스로 거부한다.
- 실패 시: 투영을 멈춰야 하면 `--clear --apply`(T 를 비움). T 를 잘못 넣었으면 바른 값으로 다시 `--apply`.

### 4-2. Ⓐ 재고 동기화 — 마지막

```bash
DRY_RUN=1 bash scripts/sellmate/run.sh live import-products apps/core/tmp/   # 🔍
bash scripts/sellmate/run.sh live import-products apps/core/tmp/             # ✅
DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/        # 🔍 증가·감소 건수
bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/                  # ⛔ 마지막 sync-stock
```

- `sync-stock` 이 **exit 2**(매칭된 SKU 재고 바뀜)로 끝나면 짝으로 `bash scripts/sellmate/run.sh live recalc-sellable .`(🔍 `DRY_RUN=1` 먼저).
- 음수 재고 오류면 `CLAMP_NEGATIVE=1` 로 다시(`scripts/sellmate/LAUNCH.md` §4).
- 실패 시: import·sync 는 단일 트랜잭션이라 중간 실패는 전부 롤백이다. 원인을 고쳐 **같은 파일로** 다시 돈다. core 에 없는 품목으로 멈추면 import 를 먼저 돌렸는지 본다(`ALLOW_MISSING=1` 은 쓰지 않는다 — 그 품목은 저녁 맞추기의 짝 못 지음이 된다).

### 4-3. Ⓔ 선반 위치 → Ⓕ 로케이션 마스터 — 마지막

**`load-shelf-positions` 를 돌리기 직전 시각을 적는다: `<positions-since>`** (§5 가 쓴다).

```bash
DRY_RUN=1 bash scripts/sellmate/run.sh live load-shelf-positions <재고 CSV>   # 🔍
bash scripts/sellmate/run.sh live load-shelf-positions <재고 CSV>             # ✅ 마지막
bash scripts/sellmate/run.sh live build-location-master                       # 🔍
bash scripts/sellmate/run.sh live build-location-master --apply               # ✅
```

판정: 판정 «로케이션 3» 에 `로케이션이 없는 선반 코드` ✗ 가 없다.

실패 시: `랙 … 건너뜀: 같은 코드의 zone 로케이션이 있어` 가 나오면 그 랙의 칸은 안 생긴다 — 그 선반의 SKU 는 §5 에서 `no-location` 으로 입고기본존에 남는다(출고는 셀메이트 위치 텍스트로 된다). 같은 코드의 zone 을 어떻게 할지는 사람이 정하고, 정한 뒤 `build-location-master --apply` 를 다시 돌린다(11-19 로컬 리허설에서 나왔다).

### 4-4. ⛔ 저녁 맞추기 init — 첫 기준값·넘긴 주문 (#1304)

마지막 `sync-stock` 에 쓴 **바로 그 재고 CSV** 로 돌린다. 기준값(셀메이트 가용, 음수는 0 + 이월 모자람)·넘긴 자사몰 주문 집합(`sellmate_handed_over_orders`)을 쓴다. 원장은 안 쓴다. **한 번뿐이다** — 두 번째는 거절한다.

```bash
WITH_MEDUSA=1 bash scripts/sellmate/run.sh live evening-reconcile init <재고 CSV> \
  --cutover-at=<T> --sellmate-orders=<미발송 주문 목록> --own-mall-channel=<자사몰 판매처 이름>            # 🔍
# ⛔ 같은 명령 끝에 --apply
```

- dry-run 이 부천 ON_HAND ≠ `max(0, 현재재고 − 미발송)` 품목 표를 찍고 1 로 끝나면: 4-2 뒤에 누가 재고를 바꿨는지 본다. 설명되면 `--accept-onhand-mismatch`.
- 넘긴 자사몰 주문 0건으로 거절되면: 판매처 이름이 틀렸을 가능성이 먼저다. 정말 0건이면 `--no-handed-over-orders`.
- 짝 못 지은 품목·사라진 품목·SKU 가 바뀐 품목이 있으면 쓰지 않고 1. 짝 표도 안 쓰므로 같은 CSV 로 `pair --apply` 를 돌려 판정이 보게 한 뒤 고친다.

**판정:** 판정 «재고 1. 저녁 맞추기» 의 기준값이 생겼고 짝 못 지은 품목 0. `--after-cutover=<T>` 의 «출고 7» 은 «저녁 맞추기 init(…) 뒤 셀메이트 재고 sync 없음» — 4-2 의 마지막 sync 는 T 뒤에 찍히지만(T ≥ 스냅샷) 금지선은 init 이라 정상이다. init 전에 돌리면 «init 이 없다» ✗ 가 나온다(이 단계를 먼저 하라는 뜻). 이 뒤 `sync-stock` dry-run 이 거절하는지 본다(가드가 살아 있다는 증거, `DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/`).

### 4-5. 이 뒤로 다시 돌리지 않는 스크립트

| 스크립트 | 멈추는 때 | 이유 |
|---|---|---|
| Ⓐ `sync-stock` | 4-2 | ⛔ 절대값. core 원장을 셀메이트 숫자로 되돌린다. `init` 뒤에는 거절 |
| Ⓐ `import-products` | 4-2 | 신상품은 PIM 에 등록하고, 셀메이트 등록은 마켓 상품만 한다. 셀메이트에만 생긴 품목은 저녁 맞추기가 «짝 못 지음»으로 띄운다 — core 에 SKU 를 만들고 `pair` |
| Ⓐ `recalc-sellable` | 정기 실행만 멈춤 | 도구로는 남는다 — `apply` 뒤 재계산 실패 때 24시간 안에 돌린다(§8) |
| Ⓑ `clear-reservations` | 4-1 | Medusa 예약은 T 부터 투영(#1247)이 맞춘다. T 설정 뒤에는 거절 |
| Ⓒ `close-shipped-shipments` | **T** | 채널·취소를 안 가려 앱이 맡은 취소 주문의 상자까지 닫는다. **T 뒤 단독 실행 금지** — 드레인 끝의 `close-sellmate-leftovers`(§7)가 대상 주문으로 좁혀 대신한다 |
| Ⓓ `short-close-overdue-po-lines` | T | 셀메이트 입고 시기의 정리용이다. T 부터 입고는 앱이 받으므로 미수령 라인이 진짜 대기일 수 있다 |
| Ⓔ `load-shelf-positions` | 4-3 | 셀메이트 위치 텍스트는 T 에 굳는다. 위치의 원천은 원장 로케이션(#1237) |
| Ⓕ `build-location-master` | 4-3 | 입력(`sku_shelf_positions`)이 굳는다. 새 칸은 어드민 «로케이션 관리»에서 |
| ①③ 입고예정 적재·투영 | 이미 폐지(#1240) | 입고예정의 원천은 선적·발주 라인 |
| `collect-cellmate` | §3 | T 뒤 자사몰 주문은 앱으로 간다 |
| `mark-shipped-from-csv`·`mark-core-shipped`·`mark-medusa-shipped` | §7 의 마지막 한 번 | 드레인이 끝나면 넘길 주문이 없다 |
| `handover-stock-addback` | (2단계 스크립트) | 쿠팡 넘겨받기용. `init` 뒤 거절 |

---

## 5. 재고를 선반으로 (#1236)

**4-3 직후에 한 번만.** `sync-stock` 이 증가분을 입고기본존에 넣으므로 전날 옮기면 다시 갈린다. 며칠 뒤 다시 돌리지 않는다 — 묶이지 않은 앱 입고분까지 쓸어 간다.

```bash
bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<positions-since> --include-rule=dash-position            # 🔍
bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<positions-since> --include-rule=dash-position --apply    # ✅
# 판매 창고가 둘 이상이면 --warehouse-id=<부천 창고 id>
```

- 고쳐 읽기 규칙은 `dash-position`(`O21-30-` → `O-21-30`)만 켠다 — 11-18 부천 현장 확인으로 정했다(기록은 PR #1424, 머지 전 — 결정은 머지와 무관하다). `zero-pad`·`custom-bin` 은 켜지 않는다.
- 동시 처리는 기본 4 그대로 둔다. 8·16 은 터널을 죽였다. dry-run 이 몇 분, **apply 는 그보다 몇 배** 걸린다 — 시간을 비워 둔다.
- 옮기지 않은 SKU 는 사유와 함께 CSV 로 남는다 — 컷오버 뒤 실사 대상이다. 그 파일을 보관한다.

**판정:** 판정 «로케이션 2» 의 ◆(위치가 하나인 SKU 의 재고가 입고기본존에 남음)가 사라졌다.

**실패 시:** dry-run 의 대상 수가 0 이면 데이터보다 **연결부터 의심한다**(터널·`--positions-since` 값·창고). apply 중 터널이 죽으면 터널을 다시 띄우고 **같은 명령·같은 `--positions-since`** 로 다시 돈다 — 옮긴 SKU 는 입고기본존 잔량이 0 이라 대상이 아니고, 멱등키가 출발 원장 version 을 담는다(스크립트 머리 주석). 다시 돈 뒤 판정 «로케이션 2» 로 확인한다. 이 단계를 못 끝내도 출고는 된다 — 송장은 셀메이트 위치 텍스트를 찍는다(`label-items.ts`).

---

## 6. 앱 출고 열기 (#1412)

### 6-1. 출고 준비 화면은 4-4 뒤에 연다

`init --apply` 전에는 넘긴 주문 표가 비어 있어 셀메이트 상자가 가려지지 않는다. 그 전에 «출고 준비»(`/order/waybill-issue`)를 누르면 기본 선택(앞쪽 100건)이 셀메이트 주문을 먼저 잡는다. **4-4 전에는 아무도 출고 준비 화면을 쓰지 않는다** — 물류팀에 미리 알린다.

4-4 뒤에는 셀메이트 상자가 화면에서 빠지고, 확정·합치기·배치 추가·합류는 `SHIPMENT_HANDED_OVER_TO_SELLMATE`(409)로 거절된다. **이미 배치에 든 상자는 장치가 막지 않는다** — 6-2 로 센다.

### 6-2. init 직후 셀메이트 상자 세기 (읽기 전용)

core DB 에서 읽기 전용으로 돌린다. 교환 상자까지 세어 넉넉히 센다.

```sql
WITH s AS (
  SELECT sh.id, sh.status,
         bool_or(h.sales_order_id IS NOT NULL) AS has_sellmate,
         bool_or(h.sales_order_id IS NULL) AS has_other
    FROM shipments sh
    JOIN shipment_lines sl ON sl.shipment_id = sh.id
    JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
    JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
    LEFT JOIN sellmate_handed_over_orders h ON h.sales_order_id = fo.sales_order_id
   WHERE sh.status IN ('draft', 'planned')
   GROUP BY sh.id, sh.status
)
SELECT count(*) FILTER (WHERE has_sellmate AND EXISTS (
         SELECT 1 FROM outbound_batch_work_items w
          WHERE w.shipment_id = s.id AND w.status NOT IN ('excluded', 'completed'))) AS in_batch,
       count(*) FILTER (WHERE has_sellmate AND status = 'planned') AS planned,
       count(*) FILTER (WHERE has_sellmate AND has_other) AS mixed
  FROM s;
```

| 열 | 0 이 아니면 |
|---|---|
| `in_batch` | 그 상자를 배치에서 뺀다(배치 화면 «박스 빼기»). 사람이 본다 — 이 상자는 비상 출고 스크립트(§10)도 가리지 못한다 |
| `planned` | 이미 계획 확정된 셀메이트 상자다. 배치에 넣지 않는다(추가·합류는 409). 드레인 끝 `close-sellmate-leftovers` 가 닫는다 |
| `mixed` | 셀메이트 줄과 다른 줄이 함께 든 상자. 그 안의 앱 주문은 드레인 끝까지 묶이니 상자를 나눈다 |

**판정:** 세 값이 0, 또는 0 이 아닌 상자마다 처리를 적었다. `in_batch` 는 빼고 나서 같은 SQL 을 다시 돌려 0 을 본다 — 작업자 권한(`fulfillment.warehouse.operate`)으로 뺄 수 있고, 뺀 상자를 다시 넣으면 409 다(11-19 로컬 리허설, `worker01`).

⚠️ 409 `SHIPMENT_HANDED_OVER_TO_SELLMATE` 는 어드민·창고 앱에 한국어 문구가 없다(#1465 가 고친다 — 고쳐지면 이 문단을 지운다) — 작업자에게는 서버의 영어 문장(`… belongs to an order Sellmate ships`)이 보인다. 당일 전에 작업자에게 «이 문장 = 셀메이트가 내보낼 주문, 건드리지 않는다» 를 알려 둔다.

### 6-3. 첫 1건 먼저

T 이후 자사몰 주문 **1건만** 출고 준비 → 배치 → 스테이션 앱 출고로 낸다. 다음을 보고 나머지를 연다.

- [ ] core `stock_events` 에 그 상자의 SHIP 이 찍혔다
- [ ] Medusa 주문 `metadata.coreShipmentAttempts[].invoice.trackingNo` 가 상자 송장과 같다(최상위 `coreTrackingNumber` 는 보지 않는다 — 쓰는 코드가 없다)
- [ ] 판정 «Medusa 1» 에 그 주문의 남은 예약이 없다 — **출고 뒤 몇 분 기다린 뒤에 본다.** 예약을 줄이는 쓰기는 정착 지연(`RESERVATION_PROJECTION_SETTLE_MS`, 기본 5분)과 그 variant 의 가용재고 이벤트가 처리될 때까지 미뤄진다(오버셀 방지). 그동안 channel_adapter `inbox_events` 의 그 판매주문 행은 `deferred: 재고 정착 대기` 로 남고 «Medusa 1» 은 ✗ 다 — 정상이다. 11-19 로컬 리허설에서 출고 약 6분 뒤 풀렸다

**실패 시:** 진단은 §12(Medusa 반영이 안 보이면 §12-3 의 조회). 송장 발급에서 멈추면 출고주문 상세의 멈춘 송장 패널(#1241). 앱 출고 경로가 막히고 core·한진은 응답하면 §10 비상 출고.

---

## 7. 드레인과 마지막 정리 (#1243)

T 이전 자사몰 주문(넘긴 주문)은 **셀메이트가 끝까지 내보낸다.** 며칠 걸릴 수 있다. 그동안 셀메이트 쪽 일은 평소대로, 앱 쪽은 그 주문을 건드리지 않는다. 첫 저녁 맞추기(§8)는 드레인을 기다리지 않는다.

### 7-1. 끝났는지 보기

셀메이트 미발송 목록에서 자사몰 판매처 주문이 0 이 되면, 아래 순서로 한 번씩.

1. **`mark-shipped-from-csv`** — 셀메이트 출고 주문 파일로 core 판매주문을 `shipped` 로.
   ```bash
   cd deployments/lcnine/services
   npx sst shell --stage live -- npx tsx ../../../scripts/sellmate/mark-shipped-from-csv.ts <주문 CSV|XLSX>            # 🔍
   npx sst shell --stage live -- npx tsx ../../../scripts/sellmate/mark-shipped-from-csv.ts <주문 CSV|XLSX> --apply    # ✅ 마지막
   ```
2. **`mark-core-shipped` · `mark-medusa-shipped`** — 매일 돌리던 사람이 늘 하던 방식(`scripts/ops/cellmate-local/README.md`, 같은 sst shell 에 `DISPLAY_IDS=…`)으로 마지막 한 번. ⚠️ 이 둘은 **dry-run 이 없다** — 돌리면 바로 쓴다. `DISPLAY_IDS` 를 두 번 확인한다.
3. **`close-sellmate-leftovers`** — 🔍 `bash scripts/sellmate/run.sh live close-sellmate-leftovers` → 출력의 «보고(닫지 않음)» 를 읽는다 → ✅ `--apply`.

**T 뒤 `close-shipped-shipments` 는 단독으로 돌리지 않는다.** 이 스크립트가 그 일을 대상 주문으로 좁혀 대신한다.

### 7-2. 완료 판정 — 셋 다

- [ ] `close-sellmate-leftovers` 의 **«드레인 미완료 0»**
- [ ] 판정(`--after-cutover=<T>`) **«출고 6»** 의 ◆ «이미 끝난 자사몰 주문의 매칭 대기» 0
- [ ] 판정 **«출고 4»** 의 «끝난 출고주문에 붙은 확정 예약 0»

### 7-3. 실패 시

| 증상 | 할 일 |
|---|---|
| «드레인 미완료 N» | 셀메이트가 아직 안 내보냈거나, 1·2번이 그 주문을 빠뜨렸다. 셀메이트 미발송 목록과 대조해 나간 주문이면 1·2번을 그 주문으로 다시, 아니면 기다렸다가 7-1 처음부터 |
| «드레인 미완료: 넘긴 주문 집합 없음» | 4-4 `init` 이 안 됐다. §4-4 부터 |
| «FO 가 사람이 볼 상태» N건 | 출력 파일의 `human-fo` 줄. 출고주문 상세에서 사람이 본다 |
| «앱이 출고를 붙인 주문» N건 | 교환품·입점사 상자. 사람이 옛 줄만 닫는다(FO 째 닫으면 앱 출고가 «발송됨»이 된다) |
| «취소 주문인데 FO·상자가 열림» | 리컨실러 몫. 다음 날 다시 본다 |
| `recovery_required`·진행 중 작업 항목 상자 | 그 상자를 앱 쪽에서 끝내거나 푼 뒤 3번을 다시 |
| «앱 주문 줄과 섞인 상자» | 그대로 발송하면 409. 상자를 나눠 셀메이트분 줄을 뺀 뒤 3번을 다시 |
| 「출고 4」 확정 예약이 남음 | 그 줄의 해결책(`releasePartial`, 또는 3번 재실행)대로. 3번은 다시 돌려도 된다 |

보고 목록 파일에는 주문 식별자가 들어 있다 — 커밋하지 않는다.

---

## 8. T 당일 저녁 첫 맞추기 (#1304)

**T 당일 저녁에 무조건 돈다** — 드레인을 기다리지 않는다. 그 뒤 매일 저녁, 물류팀 작업이 끝난 뒤.

### 8-1. 운영 규칙 — 맞추는 동안 셀메이트 출고·반품 입고 멈춤

받기(1) → 업로드(3) → 다시 받기(4) 사이에 셀메이트 출고나 반품 입고가 일어나면 그 변화가 덮이거나 다음 회에 잘못 더해진다. 반품 입고는 닫기 확인에도 안 잡힌다(조용한 유실). 그래서:

- [ ] 시작 전에 물류팀에 «지금부터 셀메이트 출고·반품 입고 멈춤» 을 알리고 답을 받는다
- [ ] 셀메이트에서 재고를 손으로 고치지 않는다(언제든)
- [ ] `close --apply` 가 끝나면 «재개» 를 알린다
- 새 마켓 주문이 들어오는 것은 괜찮다(미발송만 바뀌어 다음 회에 바르게 잡힌다).

### 8-2. 절차

```bash
# 1. 셀메이트 재고 현황 CSV 받기 → apps/core/tmp/
bash scripts/sellmate/run.sh live evening-reconcile apply apps/core/tmp/<받은 CSV>            # 🔍 품목별 차이·올릴 값
bash scripts/sellmate/run.sh live evening-reconcile apply apps/core/tmp/<받은 CSV> --apply    # ✅ 원장 반영 + 업로드 CSV
# 3. <OUT_DIR>/sellmate-reconcile-<회차>-upload.csv 를 셀메이트 «재고 수정» 에 올린다
# 4. 재고 현황 CSV 를 «다시» 받는다(새 파일)
bash scripts/sellmate/run.sh live evening-reconcile close apps/core/tmp/<다시 받은 CSV>            # 🔍
bash scripts/sellmate/run.sh live evening-reconcile close apps/core/tmp/<다시 받은 CSV> --apply    # ✅ 기준값 확정
```

**판정:**
- [ ] `close` 종료 0(✗ 없음) — 품목마다 셀메이트 가용 = core 가용
- [ ] `bash scripts/sellmate/run.sh live evening-reconcile status` — 열린 회차 없음. 이월 모자람이 있는 품목은 목록을 남긴다
- [ ] 판정 `--after-cutover=<T>` 재실행 — «재고 1» 초록, «출고 7» 의 «저녁 맞추기 init(…) 뒤 셀메이트 재고 sync 없음»

### 8-3. 실패 시

| 증상 | 할 일 |
|---|---|
| `apply` 가 짝 못 지은·사라진·SKU 바뀐 품목으로 1 | 쓰지 않았다. 같은 CSV 로 `pair --apply` → 고친 뒤 **새로 받은 CSV** 로 다시 |
| 같은 CSV 로 `apply` 를 또 돌림 | «이미 반영했다 — 원장을 다시 쓰지 않는다» 와 업로드 파일 경로를 다시 찍고 0 으로 끝난다(멱등, 정상). 그 업로드 파일을 올리면 된다 |
| `apply --apply` 뒤 sellable 재계산 실패 | 원장은 이미 커밋됐다. `apply` 를 다시 돌리지 말고 24시간 안에 `bash scripts/sellmate/run.sh live recalc-sellable .` |
| `close` 가 `shipped_before_upload` | 업로드 전 출고 또는 마켓 취소다. 셀메이트 주문 목록에서 본다. 출고면 `--apply` 가 쓴 `…-fix.csv` 를 올리고 다시 받아 `close`. 취소면 fix 를 올리지 말고 새로 받은 CSV 로 `close --accept-landed=<품목>` |
| `close` 가 다른 ✗ | **자동으로 다시 올리지 않는다.** 어긋난 품목·양쪽 숫자를 보고 사람이 정한다. 실패한 `close` 에 쓴 CSV 는 다시 못 쓴다 — 새로 받는다 |
| fix 를 만든 품목이 «현재만 늘었다» | 그 회차가 닫힐 때까지 반품으로 안 받는다. 진짜 반품이면 `--accept-landed`, 아니면 `--accept-not-landed`(둘 다는 거절) |

닫힌 회차의 업로드·fix 파일은 다시 올리지 않는다 — 셀메이트를 옛 숫자로 덮는다.

---

## 9. 다음 날 아침

- [ ] 04:30 KST 대사 뒤 어드민 `/order/channel-mismatches` 와 판정(`--after-cutover=<T>`)의 Medusa 축. 그 전에는 대사 회차가 없어 신선도 줄이 빨갛다(정상).
- [ ] 판정 전체가 1단계 ✗ 없음. ◆ 가 남았으면 드레인(§7) 진행 상황이다.
- [ ] 앱·admin-web 목록에 이미 나간 셀메이트 주문이 다시 보이지 않는다(드레인이 끝난 뒤).
- [ ] 보충 제안 수요 통계가 마켓 판매를 못 본다 — 필요하면 §3 의 주문이력으로 `import-demand-history`(`scripts/sellmate/README.md`).

---

## 10. 비상 출고 (#1249, PR #1434)

**쓰는 날:** 창고 앱 출고 경로가 막혔고 **core·한진 API 는 응답하는** 날만. core 라우트가 고장 나면 이 길도 막힌다(고쳐서 배포). 한진 API 가 오래 멈추면 이 길도 막힌다 — 기다리고, 멈춘 송장은 #914 / #1241 화면으로 푼다.

**절차의 정본은 [`scripts/ops/emergency-outbound/README.md`](../../scripts/ops/emergency-outbound/README.md)다.** 아래는 요약이다. 다르면 README 가 맞다.

**드레인 중이면 §6-2 가 먼저다.** 아직 배치에 안 든 셀메이트 상자는 스크립트가 빼지만, 이미 배치에 든 셀메이트 상자는 스크립트도 가리지 못한다.

### 10-1. 사전 준비 (리허설 때)

- [ ] 송장 프린터 Windows 공유 설정, 공유 이름 적기 `<공유 이름>`, `copy /b` 시험 출력
- [ ] 운영자 계정 권한: `fulfillment.shipment.read` · `fulfillment.warehouse.operate` · `fulfillment.dispatch.force` · `inventory.stock.read`
- [ ] 창고가 낱개 피킹(discrete)을 지원(판정 «출고 1»)
- [ ] 창고 id 적기 `<창고 id>` — 어드민 «로케이션 관리»(`/inventory/locations`)에서 창고를 고르면 주소 끝 `?warehouseId=` 뒤의 값
- 권한·낱개 피킹은 명령마다 먼저 확인하고, 모자라면 아무것도 안 바꾸고 멈춘다.

### 10-2. 아침

```bash
npx tsx scripts/ops/emergency-outbound/index.ts prepare --stage live --warehouse <창고 id>                            # 🔍 대상·뺀 사유, 실행 id 를 적는다
npx tsx scripts/ops/emergency-outbound/index.ts prepare --stage live --warehouse <창고 id> --run <실행 id> --apply    # ✅
```

- **종료 2** 면 끝의 «사람이 봐야 할 문제» 상자는 꺼내지 않는다(저녁에 그 줄을 지운다).
- 스테이션 PC: `copy /b labels.zpl \\localhost\<공유 이름>` — **반드시 찍는다**(스크립트는 출력 확인을 이미 기록했다).
- `pick-list.html` 을 A4 로 뽑아 꺼내기·포장·한진 기사 인계.

### 10-3. 저녁

1. `.scratch/emergency-outbound/<실행 id>/shipments.csv` 에서 **못 나간 상자의 줄을 지운다** — 문제 상자·일부만 담긴 상자·낮에 취소된 상자(박스는 도로 빼 둔다). 지우지 않은 줄 = 실제로 나간 박스다.
2. 🔍 `npx tsx scripts/ops/emergency-outbound/index.ts dispatch --stage live --run <실행 id>` — «목록에서 빠진 상자» 가 지운 줄과 맞는지.
3. ✅ 같은 명령 `--apply`. 마지막 줄 **`실행 <실행 id> 을 끝냈다`** 를 본다. 이 줄이 나와야 그 실행이 상자를 놓아준다(못 나간 상자는 다음 날 정식 경로나 새 `--run`).

- `dispatch --apply` 는 **하루 한 번, 마지막 인계 뒤.** 낮에 돌리면 아직 안 나간 상자가 풀려 같은 날 새 실행이 라벨을 또 찍는다.
- 낮에 앱이 돌아와 비상 경로를 접은 날도 저녁 dispatch 는 돌린다 — 나간 줄만 남기고, 없으면 머리줄만.

### 10-4. 실패 시

| 증상 | 할 일 |
|---|---|
| **dispatch 종료 2(거절·불일치)** | 그 줄의 박스는 **이미 나갔다.** 실행 id·상자 id 를 적어 **그날 바로 개발자에게.** 닫은 뒤 dispatch 를 다시 돌려 «끝냈다» 를 본다. «다음 날 정식 경로로» 미루지 않는다. 줄마다 닫힌 모양은 README 표 — `canceled`·«이번 실행의 상자가 아니다» 는 줄을 지우고, **planned 상자의 거절 줄은 지우지 않는다**(지우면 다음 실행이 라벨을 다시 찍는다) |
| 중간에 죽음 | 같은 명령·같은 사람·같은 `--run` 으로 다시(이어진다) |
| 송장 발급 멈춤 | #914 / #1241 화면 |
| 송장 일시 실패·시작 막힘으로 빠진 상자 | 그 실행엔 다시 안 들어온다. 다음 날 정식 경로 또는 새 `--run` |
| 다른 사람이 시작한 실행·끝난 실행 | 새 `--run` |

실행 폴더(`.scratch/emergency-outbound/<실행 id>/`)는 **지우지도 옮기지도 않는다.** 같은 PC 에서 돌린다.

---

## 11. 리허설 체크리스트

리허설은 두 번이다.

- **① 로컬** — 당일 순서를 `--apply` 까지(⛔ 단계 포함) 실제로 돌린다. 셀메이트는 가짜(`scripts/local/sellmate-rehearsal/`, 절차는 그 README). 순서·가드·판정을 본다.
- **② 라이브** — 아래 체크리스트. 셀메이트 실물·권한·프린터·명령 꼴을 본다. ⛔ `--apply` 는 하지 않는다.

**작업자 계정으로 한다** — 스테이션·어드민 모두 `logistics_worker` 역할만 가진 실제 작업자 계정. 관리자 계정으로 통과한 것은 통과로 치지 않는다. 막히는(403·버튼 없음) 곳은 그 자체가 발견이다 — 누가 그 일을 맡는지(작업자·admin)를 이 문서에 적는다.

준비: 리허설 날짜 `<리허설 날짜>`, 작업자 계정 `<계정>`, 기록 담당 `<이름>`. 각 칸에 걸린 시간과 막힌 곳을 적는다.

### 11-1. 이 런북을 위에서부터

- [ ] §0-2 판정을 두 셸에서 돌리고 출력 절 이름으로 이 문서의 «판정 …» 을 찾을 수 있다
- [ ] §2 아침 준비(로그인·터널·판정)를 이 문서만 보고 했다
- [ ] §3 셀메이트 파일 다섯 개를 받았다(받는 화면·양식 이름을 여기 고쳐 적는다)
- [ ] §4 의 모든 🔍 를 **dry-run 으로만** 돌렸다. ⛔ `--apply` 는 리허설에서 돌리지 않는다(`sync-stock` 은 dry-run 도 `DATABASE_URL` 이 필요하다 — `run.sh` 가 넣는다)
- [ ] §4-1 `set-reservation-cutover` 를 sst shell 꼴 그대로 **dry-run** 으로 돌려 «지금 값»(비어 있음)이 찍힌다 — 라이브에서 처음 쓰는 명령 꼴이라 여기서 확인한다
- [ ] §5 `move-stock-to-shelf` dry-run 의 대상 수가 0 이 아니고, 걸린 시간을 적었다(apply 는 그 몇 배)
- [ ] §6-2 SQL 을 읽기 전용으로 돌렸다(init 전이라 0 이 정상 — 쿼리가 도는지만)
- [ ] §7-1 `close-sellmate-leftovers` dry-run 이 «넘긴 주문 집합 없음(init 전)» 을 찍는다
- [ ] §8 의 «첫 live `--apply` 전 확인»(§1) 네 개가 끝났다

### 11-2. 알려진 막힘의 탈출구 — 작업자 계정으로 한 번씩

| 막힘 | 탈출구 | 누른 사람 | 결과 |
|---|---|---|---|
| 배송 프로필 없음(계획 확정 실패) | 어드민 «배송 프로필»(`/inventory/delivery-profiles`) — 판정 «출고 2» | skutest1(작업자), 11-19 라이브 | 목록만 보이고 추가·편집·삭제가 없다(`inventory.master.write` 는 admin·물류 관리자만). SKU 의 프로필 지정도 같은 권한이다 → **물류 관리자·admin 이 맡는다** |
| 예약 불일치(재고 부족·유령 예약) | 출고 정체 보드(`/order/stall-board`)에서 사유 확인 → 판정 «출고 4» 가 적은 해결책 | skutest1(작업자), 11-19 라이브 | 보드는 열리고 단계별 건수·정체 사유가 보인다(0 수집 칸만 가림). 해결 버튼은 없고 주문번호 링크는 주문 내역(`/order/history`, `order.order.read`)으로 가서 403. 3 예약 칸이 0 이라 예약 불일치 해결 동작은 미확인 → **작업자는 사유까지 보고 admin 에게 넘긴다** |
| 매칭 대기 | 어드민 «매칭»(`/order/matching`) — 판정 «출고 6» | skutest1(작업자), 11-19 라이브 | 화면이 열리지 않는다(접근 권한 없음, `order.order.read`). 매칭 저장(`order.matching.write`)도 admin 만 → **admin 이 맡는다** |
| 수취인 정보 빠짐 | 출고주문 상세(`/order/fulfillments`)의 수취인 수정 — 판정 «출고 3» | skutest1(작업자), 11-19 라이브 | 출고주문 상세는 열리지만 «수령인 변경» 버튼이 없다(`fulfillment.shipment.override_recipient` 는 admin·물류 관리자만). 받는 분 정보도 가려져 보인다 → **물류 관리자·admin 이 맡는다** |
| 운송장 교착(멈춘 송장) | 출고주문 상세의 멈춘 송장 패널 → abandon(#1241) | skutest1(작업자), 11-19 라이브 | 테스트 주문 상자에 `pending` 송장 행을 직접 넣어 재현했다. 패널이 뜨고 «중단하고 다시 발급» → 사유 입력 → 중단까지 작업자가 403 없이 끝냈고 행은 `abandoned` 가 됐다. 이어지는 새 발급 창은 닫아도 된다 → **작업자가 맡는다** |
| 셀메이트 상자 거절(409 `SHIPMENT_HANDED_OVER_TO_SELLMATE`) | 거절 문구를 작업자가 읽고 다음 할 일을 아는가(§6) | | |

### 11-3. 비상 출고 경로 한 번 (라이브 창고)

- [ ] §10-1 사전 준비 네 개(공유 프린터·권한·낱개 피킹·창고 id)
- [ ] `prepare --stage live --warehouse <창고 id>` **dry-run** — 사전 점검 통과, 대상과 뺀 사유가 보인다
- [ ] 송장 프린터 공유로 `copy /b` 시험 출력
- `dispatch` 는 돌리지 않는다 — `prepare --apply` 가 남긴 `run.json` 이 있어야 돈다.

### 11-4. 끝

- [ ] 이 문서만 보고 끝까지 갔다(#1251 완료 조건). 막힌 곳·고친 문장을 이 문서에 반영했다
- [ ] §3 의 «collect-cellmate 마지막 실행과 재고 CSV 받기 사이» 에 걸린 시간을 쟀다 — 이 틈에 들어온 자사몰 주문은 셀메이트에도 넘긴 주문에도 없다. 틈이 길면 T 당일 그 사이 주문 번호를 적어 두고 앱 출고 목록에 있는지 본다

---

## 12. 막혔을 때 — 상자 막힘 지도 (#1250 대신)

진단 도구(#1250)는 만들지 않기로 했다(2026-11-19) — 조회 경로·화면을 늘리지 않는다. 막히면 개발자가 Claude 에게 라이브 DB 를 읽게 한다. 이 절은 그때 Claude 에게 줄 시작점이다. **함수 이름이 정본이다** — 조건은 그 함수의 코드를 읽어서 따른다(여기 옮겨 적지 않는다. 옮겨 적은 판정은 코드와 갈린다).

### 12-1. Claude 에게 맡기는 법

- 터널(§2) 위에서, 판정 스크립트의 `scripts/ops/cutover-preflight/db.ts` 의 `connect`·`readOnly` 로만 읽게 한다. READ ONLY 트랜잭션이라 쓰기 문이 섞여도 DB 가 거부한다. 실행은 §0-2 와 같은 `npx sst shell --stage live -- npx tsx <스크립트>` 꼴(services 셸 = core·channel_adapter·medusa).
- 주문번호·상자 id·송장번호 중 하나와 «어디서 무엇이 거절됐나»(화면 문구·409 코드)를 함께 준다.
- Claude 는 고치지 않는다. 아래 «푸는 곳»을 사람이 누른다 — 누가 맡는지는 §11-2.
- 시작 말 예: «런북 §12 를 읽고, 주문 <번호> 의 상자가 왜 <단계> 로 못 가는지 라이브 DB 를 readOnly 로 읽어 판정해 줘. 판정 조건은 §12-2 의 함수 코드를 읽고 따른다.»

### 12-2. 순서와 단계별 문

순서: 수집(channel-adapter) → 판매주문 → 출고주문 대기열 → 상자(draft)·예약 → 계획 확정(draft→planned) → **송장 발급 → 배치 합류**(송장이 배치보다 먼저다) → 배치 시작 → 피킹·검수 → 발송 → 채널 반영(channel-adapter).

| 단계 | 문 (정본 함수) | 푸는 곳 |
|---|---|---|
| 번호 → 상자 | `join-candidate.queries.ts` `findShipmentIdsByCode` — 판매주문 `display_order_no`·`channel_order_id`, 활성 송장 `tracking_no`(하이픈 뺀 것도). 창고 하나로 묶여 있으니 진단 땐 창고 조건을 뺀다. 옛 주문은 `display_order_no` 가 비어 있을 수 있다 | — |
| 상자별 지금 단계 | 정체 보드 판정 `order-progress.judge-sql.ts` `judgedShipmentsSql` + `shipmentScopeSql` — 단계 판정은 이 한 벌이다 | — |
| 수집 | channel_adapter `order_collection_failures` 의 `quarantined` 행(사유 `reason`) | 격리 화면 다시 넣기 |
| 출고주문 대기열 | core `fulfillment_order_creation_backlogs` — `awaiting_matching`(줄별 사유 `failure_details.missingLines`)·`failed`(`failure_reason`). 행이 아예 없으면 `fulfillment-workflow-gate.service.ts` `shouldEnqueueFo` | 매칭(`/order/matching`) |
| 예약 | `fulfillment-order-reservation-retry.worker.ts` — draft 상자, 가용재고가 있을 때만 다시 잡는다 | 출고 준비 «있는 것만 먼저», 정체 보드 나눠 보내기 |
| 출고 준비 분류 | `outbound-preparation.reader.ts`·`outbound-preparation-classify.ts`, 정보 부족은 `needs-info.ts` `needsInfoIssues`. 셀메이트 넘김(`loadSellmateShipmentIds`)은 화면에서 빠진다(§6) | — |
| 계획 확정 | `ShipmentPlanningService.plan` 의 `assert*` 순서 | 배송 프로필(`/inventory/delivery-profiles`), 상자 상세 수취인 수정 |
| 송장 발급 | `WaybillManager.issueForShipment`·`resumeActive`. 교착(`WAYBILL_NEEDS_REVIEW`) = 활성 `pending`/`allocated` 행의 `manifest_version`·`recipient_hash` 가 상자와 다름 — 해시는 TS(`recipientHashOf`)로만 계산된다. SQL 로는 못 본다 | 상자 상세 멈춘 송장 패널(#1241) |
| 배치 합류 | `OutboundBatchOrchestratorService.assertJoinableBox` → `WaybillManager.assertDispatchable` | 배치 화면 |
| 배치 시작 | `allocation.locks.ts` `assertStartEligibility`(`PICKING_RESERVATION_MISMATCH`). 선반 재고 부족은 배치 단위 할당(`batch-start.ts`)이라 응답이 상자별 사유를 싣는다 | 배치에서 빼기 |
| 발송 | `shipment-dispatch.service.ts`, 라벨 재출력 `label-currency.guard.ts` | 강제 출고 / §10 |
| 채널 반영 | §12-3 | — |

**함정 — 예약은 단계마다 세는 법이 다르다.** 출고 준비는 `stock_reservations.target_type='SHIPMENT_LINE'` 확정 예약, 계획 확정은 `shipment_line_id` 확정 예약, 배치 합류는 `shipment_lines.reserved_qty = qty` 에 예약의 SKU·창고 일치까지 본다. 배송 프로필도 합류가 더 엄격하다(보내는 분 이름·전화). 그래서 출고 준비에서 «출고 가능»이던 상자가 합류에서 거절될 수 있다 — 거절된 단계의 함수를 본다.

### 12-3. 발송했는데 Medusa 에 반영이 안 보인다

core 가 `ShipmentShipped` 를 내면 channel-adapter 가 받아 Medusa 에 반영한다. 어디서 멈췄는지 차례로 본다(`<상자 id>` 를 넣는다). 이 흐름을 화면에서 따라가는 일은 #1478(급하지 않음).

```sql
-- core: 나갔나
select status, created_at, published_at, failed_at from event.outbox_events
 where event_type = 'ShipmentShipped' and aggregate_id = '<상자 id>' order by created_at desc;

-- channel_adapter: 받았나 · 실패 보관함에 갔나 · 반영 결과
select status, attempts, next_attempt_at, error_message from inbox_events
 where event_type = 'ShipmentShipped' and payload->>'shipmentId' = '<상자 id>';
select status, error_message, created_at from event.dead_letters
 where event_type = 'ShipmentShipped' and envelope::text like '%<상자 id>%';
select operation, status, attempts, error_message, updated_at from channel_dispatch_operations
 where shipment_id = '<상자 id>';
```

`channel_dispatch_operations.status` 가 `failed` 면 워커가 다시 시도하는 중이다(기다린다). `manual_adjustment_required` 만 사람이 손볼 일이다. 예약 쪽은 §6-3 의 «Medusa 1» 과 정착 지연을 먼저 본다.
