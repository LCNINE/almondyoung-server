# 컷오버 로컬 리허설 (#1251)

런북 [`docs/runbooks/sellmate-cutover-phase1.md`](../../../docs/runbooks/sellmate-cutover-phase1.md) 의 당일 순서를 **로컬 스택에서 `--apply` 까지** 돌린다.
라이브에선 dry-run 밖에 못 하는 ⛔ 단계(마지막 `sync-stock` → `init` → 재고 이동 → 드레인 끝 → 첫 저녁 맞추기)를 실제로 해 보는 자리다.

| 파일 | 하는 일 |
|---|---|
| `fake-sellmate.ts` | 가짜 셀메이트. 재고 현황·미발송 주문·출고 주문 파일을 만들고, 마켓 주문·출고·반품·«재고 수정» 업로드를 흉내 낸다 |
| `seed-worker.ts` | 로컬 작업자 계정 `worker01`(`logistics_worker` 하나만, 비밀번호는 로컬 시드 값 `Rehearsal1234!`) |
| `snapshot.sh` | 리허설 전후로 `dev_core`·`medusa`·`channel_adapter`·`user_service`·`wallet` 을 떠 두고 되돌린다 — 리허설이 DB 를 «컷오버 이후» 로 만들고, 리허설 주문이 wallet 포인트로 결제하기 때문 |

**로컬 통과가 증명하지 않는 것** — 라이브 리허설(런북 §11) 몫이다:
셀메이트 실제 양식·업로드의 의미·안정재고(런북 §1 의 사람 확인), AWS 로그인·터널·`run.sh`·sst shell 명령 꼴, 라이브 역할·권한, 데이터 규모(재고 이동 시간·터널 동시성), 송장 프린터.

## 0. 준비

```bash
bash scripts/local/sellmate-rehearsal/snapshot.sh save   # 스택을 띄우기 «전»(연결 0 이어야 한다)
npm run bootstrap:e2e:local
npm run start:all:local                  # 안 끝나는 명령 — 다른 창에서. 가짜 한진 포함
npm run seed:order-path:local
npm run order:place:local -- --count 5   # T 이전 자사몰 주문 = 셀메이트에 넘길 주문
npx tsx scripts/local/sellmate-rehearsal/seed-worker.ts

export L=postgresql://postgres:postgres@localhost:5432   # 테넌트 1 core 는 dev_core
export OUT_DIR=.scratch/sellmate-rehearsal               # 가짜 셀메이트 파일과 저녁 맞추기 업로드 CSV 가 같이 쌓인다
FS="npx tsx scripts/local/sellmate-rehearsal/fake-sellmate.ts"
```

- 🔴 스택이 떠 있는 동안 전체 jest·type-check 를 돌리지 않는다(메모리 부족).
- 런북의 `bash scripts/sellmate/run.sh live <스크립트> …` 는 로컬에서 `DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/<스크립트>.ts …` 다. `DRY_RUN=1` 관례는 같다.
- 판정(런북 §0-2)은 로컬에서 이렇게 돈다(`--after-cutover=<T>` 도 같다):
  ```bash
  CORE_DATABASE_URL=$L/dev_core CHANNEL_ADAPTER_DATABASE_URL=$L/channel_adapter MEDUSA_DATABASE_URL=$L/medusa \
  USER_SERVICE_DATABASE_URL=$L/user_service npx tsx scripts/ops/cutover-preflight/index.ts
  ```

## 1. 런북 §1 — 짝 표·바코드번호2

```bash
$FS init                     # 지금 dev_core·medusa 를 읽어 셀메이트 상태를 만든다. 안 나간 자사몰 주문 = 넘긴 주문
$FS export                   # stk_stockList_<KST>.xls · sm_unshipped_<KST>.xls
STOCK=$(ls -t $OUT_DIR/stk_stockList_*.xls | head -1); ORDERS=$(ls -t $OUT_DIR/sm_unshipped_*.xls | head -1)

DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/evening-reconcile.ts pair $STOCK --apply
DATABASE_URL=$L/dev_core DRY_RUN=1 npx tsx scripts/sellmate/backfill-barcode2.ts $STOCK
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/backfill-barcode2.ts $STOCK --apply
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/register-missing-barcodes.ts [--apply]
```

`init` 이 만드는 것: 품목마다 `현재재고 = core ON_HAND + 미발송`(마지막 sync 가 맞출 값), 처음 `--drift`(기본 2) 품목만 ±1 어긋남,
마켓 미발송 주문 `--market`(기본 3), 위치 텍스트(exact·`O21-30-`·`CC-4-1`·못 읽는 텍스트·빈 위치가 섞인다), 5품목마다 바코드번호2.
처음부터 다시 하려면 `init --force` — 단 DB 는 되돌리지 않는다(`bootstrap:e2e:local` 로 새로).

## 2. 런북 §3~§4 — T 와 ⛔ 마지막 동기화

```bash
$FS export; STOCK=$(ls -t $OUT_DIR/stk_stockList_*.xls | head -1); ORDERS=$(ls -t $OUT_DIR/sm_unshipped_*.xls | head -1)
T=<export 가 찍은 스냅샷 시각 이상, +09:00>

DATABASE_URL=$L/medusa npx tsx scripts/sellmate/clear-reservations.ts $STOCK [--apply]                       # §4-1
DATABASE_URL=$L/channel_adapter npx tsx apps/channel-adapter/scripts/set-reservation-cutover.ts --at $T [--apply]
DATABASE_URL=$L/dev_core DRY_RUN=1 npx tsx scripts/sellmate/import-products.ts $STOCK                         # §4-2
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/import-products.ts $STOCK
DATABASE_URL=$L/dev_core DRY_RUN=1 npx tsx scripts/sellmate/sync-stock.ts $STOCK
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/sync-stock.ts $STOCK                                        # ⛔ exit 2 면 recalc-sellable
POSITIONS_SINCE=$(date -Iseconds)                                                                            # §4-3 직전 시각
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/load-shelf-positions.ts $STOCK
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/build-location-master.ts [--apply]
DATABASE_URL=$L/dev_core MEDUSA_DATABASE_URL=$L/medusa npx tsx scripts/sellmate/evening-reconcile.ts init $STOCK \
  --cutover-at=$T --sellmate-orders=$ORDERS "--own-mall-channel=아몬드영(자사몰)" [--apply]                     # ⛔ §4-4
DATABASE_URL=$L/dev_core DRY_RUN=1 npx tsx scripts/sellmate/sync-stock.ts $STOCK                              # 거절돼야 한다
```

## 3. 런북 §5~§6 — 재고 이동·앱 출고

```bash
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/move-stock-to-shelf.ts --positions-since=$POSITIONS_SINCE --include-rule=dash-position [--apply]
psql $L/dev_core -f <런북 §6-2 SQL>         # in_batch · planned · mixed
npm run order:place:local -- --count 2      # T 이후 주문 — 앱 몫
```

어드민(`http://localhost:8002`, **`worker01`** 로) «출고 준비» → 스테이션 앱으로 1건 출고 → 런북 §6-3 확인.
넘긴 주문의 상자가 출고 준비에 안 보이고, 확정·배치 추가가 409 `SHIPMENT_HANDED_OVER_TO_SELLMATE` 인지 본다.

## 4. 런북 §7 — 드레인 끝

```bash
$FS ship --channel own                      # 셀메이트가 넘긴 주문을 다 내보냄. 출고 주문 파일과 DISPLAY_IDS 를 찍는다
SHIPPED=$(ls -t $OUT_DIR/sm_shipped_*.xls | head -1)
CORE_DATABASE_URL=$L/dev_core MEDUSA_DATABASE_URL=$L/medusa npx tsx scripts/sellmate/mark-shipped-from-csv.ts $SHIPPED [--apply]
CORE_DATABASE_URL=$L/dev_core MEDUSA_DATABASE_URL=$L/medusa DISPLAY_IDS=<찍힌 값> node scripts/ops/cellmate-local/mark-core-shipped.js     # dry-run 없음
MEDUSA_DATABASE_URL=$L/medusa DISPLAY_IDS=<찍힌 값> node scripts/ops/cellmate-local/mark-medusa-shipped.js                                 # dry-run 없음
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/close-sellmate-leftovers.ts [--apply]
# 판정 --after-cutover=$T : «출고 6» ◆ 0 · «출고 4» 확정 예약 0 · leftovers «드레인 미완료 0»
```

드레인 중간을 보려면 `ship --channel own --count 2` 로 일부만 내보내고 leftovers dry-run 의 «드레인 미완료» 가 남은 수인지 본다.

## 5. 런북 §8 — 첫 저녁 맞추기

```bash
$FS market-order --count 3; $FS ship --channel market --count 1; $FS cancel-market; $FS return --serial <옵션정보일련번호>
$FS export; STOCK=$(ls -t $OUT_DIR/stk_stockList_*.xls | head -1)
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/evening-reconcile.ts apply $STOCK [--apply]
$FS upload $(ls -t $OUT_DIR/sellmate-reconcile-*-upload.csv | head -1)       # 셀메이트 «재고 수정»
$FS export; STOCK=$(ls -t $OUT_DIR/stk_stockList_*.xls | head -1)            # «다시» 받기
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/evening-reconcile.ts close $STOCK [--apply]
DATABASE_URL=$L/dev_core npx tsx scripts/sellmate/evening-reconcile.ts status
```

실패 갈래를 보려면 `apply --apply` 와 `upload` 사이에 `$FS ship --channel market --count 1` 을 끼운다 — 업로드가 그 출고 전 미발송으로 계산한 값을 덮어 `close` 가 `shipped_before_upload` 를 띄워야 한다(런북 §8-3). 업로드 «뒤» 의 출고는 현재·미발송이 같이 줄어 닫기에 걸리지 않는다(정상).

## 6. 런북 §10 — 비상 출고

`npx tsx scripts/ops/emergency-outbound/index.ts prepare --stage local --warehouse <부천 id> …` — 절차는 `scripts/ops/emergency-outbound/README.md` «로컬 확인».

## 7. 끝 — 되돌리기

```bash
# start:all:local 창에서 Ctrl+C (연결이 남으면 restore 가 거절한다)
bash scripts/local/sellmate-rehearsal/snapshot.sh restore   # DB 넷 되돌림 + Kafka 소비 그룹 오프셋 끝으로 + Redis 비움
bash scripts/local/sellmate-rehearsal/snapshot.sh drop      # 다시 리허설할 게 아니면
```

`.scratch/emergency-outbound/<실행 id>/` 는 되돌리지 않는다 — 리허설 실행 폴더라 지워도 되지만, 남겨 두면 다음 로컬 비상 출고가 «앞 실행» 으로 읽는다(끝난 실행이면 상관없다).

