# 런칭 런북 — 셀메이트 재고상품/재고 → core 적용

**live core** 에 적용하는 순서. 위에서부터 그대로 따라가면 됩니다.
모든 명령은 repo 루트에서 실행.

> 핵심 원칙: **항상 DRY_RUN 먼저 → 결과 확인 → 실제 실행.** import/sync 둘 다 재실행해도 안전(idempotent).

---

## 빠른 실행 (요약)

> 명령은 `live` ↔ `dev` 만 다르다. 터널도 같은 디렉터리에서 `--stage` 만 바꾼다.
> **항상 dev 로 먼저 연습 → live.**

### dev (연습용)

```bash
# 1. dev 터널 (별도 창, 유지)
cd deployments/lcnine/services && npx sst tunnel --stage dev

# 2. 준비 점검
bash scripts/sellmate/run.sh dev check apps/core/tmp/
#   ❌ 가 나오면(테이블/시드 비어있음) dev core 1회 셋업 후 다시 점검:
#   bash scripts/sellmate/dev-setup-core.sh

# 3. 임포트 (미리보기 → 실제)
DRY_RUN=1 bash scripts/sellmate/run.sh dev import-products apps/core/tmp/
bash scripts/sellmate/run.sh dev import-products apps/core/tmp/

# 4. 재고동기화 (미리보기 → 실제)
DRY_RUN=1 bash scripts/sellmate/run.sh dev sync-stock apps/core/tmp/
bash scripts/sellmate/run.sh dev sync-stock apps/core/tmp/
```

### live (실제 반영)

```bash
# 1. live 터널 (별도 창, 유지)
cd deployments/lcnine/services && npx sst tunnel --stage live

# 2. 준비 점검
bash scripts/sellmate/run.sh live check apps/core/tmp/

# 3. 임포트 (미리보기 → 실제)
DRY_RUN=1 bash scripts/sellmate/run.sh live import-products apps/core/tmp/
bash scripts/sellmate/run.sh live import-products apps/core/tmp/

# 4. 재고동기화 (미리보기 → 실제)
DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/
bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/
```

자세한 설명·예외 처리는 아래 단계별 참고.

---

## 0. 사전 준비

- [ ] 받을 분기 범위 확정
- [ ] 모든 분기 엑셀을 `apps/core/tmp/` 에 넣었는지 (`.xls` 그대로 OK, 여러 개 가능)
- [ ] 파일 확인: `ls apps/core/tmp/*.xls`

## 1. live 터널 띄우기 (별도 창)

```bash
cd deployments/lcnine/services && npx sst tunnel --stage live
```

"Tunnel listening…" 뜨고 **창 유지**. (사설 DNS라 IP 직접 접속하므로 터널 필수.)

## 2. live 준비 상태 점검

```bash
bash scripts/sellmate/run.sh live check apps/core/tmp/
```

- `기본 홀더 ✅ / 부천 물류창고 ✅ / 부천 입고기본존 ✅` 면 바로 3번으로.
- ❌ 가 있으면 → **시드 누락**. 아래 실행 후 다시 점검:
  ```bash
  bash scripts/sellmate/run.sh live seed-refdata apps/core/tmp/
  ```
- `누락 테이블` 메시지가 나오면 → live 가 마이그레이션 안 된 상태. **중단하고 확인** (직접 마이그레이션하지 말 것).

## 3. 재고상품 임포트 (SKU/그룹 생성)

```bash
# 미리보기 (DB 안 건드림 — 그룹/SKU 개수, 매핑 확인)
DRY_RUN=1 bash scripts/sellmate/run.sh live import-products apps/core/tmp/

# 실제 반영
bash scripts/sellmate/run.sh live import-products apps/core/tmp/
```

결과: `✔ sku_groups: N개`, `✔ skus: M개`, `✔ sku_barcodes: …`

## 4. 재고량 동기화

```bash
# 미리보기 (증가/감소 건수 확인)
DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/

# 실제 반영
bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/
```

결과: `조정 계획: 증가 X건, 감소 Y건` → `동기화 완료: Z건 조정`

## 5. 검증

```bash
bash scripts/sellmate/run.sh live check apps/core/tmp/
```

skus/sku_groups/stock_events 개수가 기대대로인지 확인.

---

## 이후 재고만 갱신할 때 (운영 중 반복)

셀메이트에서 재고현황 엑셀 새로 받아 `apps/core/tmp/` 에 덮어쓰고:

```bash
DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/   # 확인
bash scripts/sellmate/run.sh live sync-stock apps/core/tmp/             # 반영
```

현재고와 차이나는 품목만 조정. 상품이 새로 늘었으면 import 도 다시.

> ⚠️ **재고매칭(SKU↔변형)이 끝난 뒤부터는 sync-stock 만으로 스토어프론트가 갱신되지 않는다.**
> sync-stock 은 core 재고(ledger/event)만 바꾸고 sellable 프로젝션은 건드리지 않는다.
> 그래서 매칭된 SKU 의 재고가 바뀌면 스크립트가 경고를 띄우고 **exit code 2** 로 끝난다.
> 이때는 바뀐 SKU 들에 대해 `recalculateAndPublishForSku` 재계산을 별도로 돌려야 노출 수량이 반영된다.
> (매칭 전 단계라 무시해도 되는 상황이면 `SKIP_SELLABLE_CHECK=1` 로 재실행해 0 종료시킬 수 있다.)
>
> 즉 운영 중 반복 재고 동기화는 "sync-stock → 재계산" 이 한 쌍이다. sync-stock 단독 반복은 매칭 전에만 안전.

## 주의 / 롤백

- **원자성**: import / sync 둘 다 전체를 **단일 트랜잭션**으로 처리 → 중간 실패 시 전부 롤백(부분 반영 없음).
- **idempotency**: import 는 code 기준 upsert, sync 는 (목표-현재) delta 만 적용 → 같은 파일 재실행 무해.
- **엄격 검증(sync)**: 재고 값이 비음수 정수가 아니면(빈값·소수·문자·음수) 0 으로 추정하지 않고 **중단**한다.
  core 에 없는 품목이 있어도 기본은 **중단**(`ALLOW_MISSING=1` 로만 부분 반영). 여러 파일에 같은 품목이
  다른 재고로 있으면 모호하므로 **중단**(`ALLOW_DUP_FILES=1` 로 최신 파일 우선 진행).
- **동시 실행 안전(sync)**: advisory lock 으로 직렬화 + 트랜잭션 내 FOR UPDATE 재읽기 → 두 번 돌아도
  같은 delta 가 중복 적용되지 않는다.
- **롤백**: import 는 비파괴(덮어쓰기만). sync 는 stock_events 에 이벤트가 누적되므로 되돌리려면
  반대 방향 조정이 필요 — 실제 반영 전 **DRY_RUN 으로 반드시 확인**.
- **재고매칭(SKU↔변형) 은 범위 밖.** 매칭을 붙인 뒤에야 스토어프론트에 재고가 노출됨
  (그때 SKU별 `recalculateAndPublishForSku` 재계산 필요 — 별도 작업).
- dev 로 먼저 연습하려면 위 명령에서 `live` → `dev` (단, dev core 가 비어있으면
  `bash scripts/sellmate/dev-setup-core.sh` 로 1회 셋업).
