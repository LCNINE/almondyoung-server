# sku_barcodes.packing_unit 타입 교정 (varchar → integer)

- 작성일: 2026-07-25
- 브랜치: `fix/packing-unit-integer` (base `origin/develop` @ `c64d65e63`)
- 관련: PR #540 (Phase 2 입고/검수, 머지됨), ADR-0005

## 배경

`packing_unit`은 "이 바코드 1회 스캔이 몇 낱개를 뜻하는가"를 담는 숫자다. SKU 하나에 바코드가 여럿 달릴 수 있고(`sku_barcodes.sku_id` FK + `barcode` UNIQUE + `is_primary`), 상품에 직접 붙은 대표 바코드 외에 그 상품이 n개 들어 있는 상자 바코드도 등록할 수 있다. 상자 바코드를 찍으면 낱개 n개를 찍은 것과 같아야 하고, 그 n이 `packing_unit`이다.

그런데 컬럼은 `varchar(64)`다(`inventory.schema.ts:567`, baseline `20260518141559_baseline.sql:1050`). CHECK 제약도 없어 `'BOX'` 같은 값이 물리적으로 들어갈 수 있다.

PR #540에서 API 계약은 이미 `number`로 통일했다. `sku-catalog/packing-unit.ts`의 `parsePackingUnit`/`serializePackingUnit`이 varchar와 number 사이의 유일한 경계 역할을 하고, 그 파일 주석이 "컬럼 타입 좁히기는 ADR-0005상 3-PR expand-contract라 별도 작업으로 미뤘다"고 명시했다. 이 스펙이 그 후속이다.

## 결정 사항

### 기존 데이터: 전량 폐기

`packing_unit` 값은 live/dev 어느 쪽에서도 실무에서 쓰이지 않는다. 순수 숫자가 아닌 값이 있다면 그 값은 버리는 편이 옳다. 따라서 **타입 변경 전에 전량 NULL로 정리**한다. 숫자만 골라 보존하는 선택지는 택하지 않았다 — 보존할 가치가 있는 값이 애초에 없고, 전량 NULL이면 롤링 배포 중 구/신 코드가 무엇을 읽든 `null`이라 타입 불일치 사고가 원천 차단된다.

### 절차: ADR-0005 3-PR을 생략하고 단일 PR

CLAUDE.md/ADR-0005 §5는 type narrow를 3-PR expand-contract(새 컬럼 + dual write → backfill + read 전환 → 옛 컬럼 drop)로 규정한다. 이번에는 **단일 PR + 인플레이스 ALTER**로 간다.

근거: 그 규율이 방어하는 대상은 (1) 데이터 손실과 (2) 롤링 중 구/신 코드가 서로의 스키마를 만나는 사고다. (1)은 버리기로 한 데이터라 정의상 발생하지 않는다. (2)는 읽기와 쓰기가 다르다. **읽기**는 마이그레이션 직후 컬럼이 전량 NULL이라 구 코드가 읽어도 `null`, 신 코드가 읽어도 `null`이므로 무조건 안전하다. **쓰기**는 조건부다 — `db:migrate` 완료 후 `sst deploy`가 끝나기 전 배포 창에 구 태스크(예: admin-web 바코드 폼)가 여전히 packing_unit을 쓸 수 있고, postgres.js가 타입 없는 JS 문자열을 보내면 서버가 그대로 integer로 캐스팅해버린다. 그 값을 구 코드가 다시 읽으면 문자열이 아닌 JS number를 받아 `parsePackingUnit(20)`이 `raw.trim is not a function`으로 죽는다(SKU 상세/목록 500). 이 경합은 운영자가 배포 창 몇 분 사이에, 실무에서 한 번도 쓰인 적 없는 필드에 값을 넣어야만 발생하고, 발생해도 구 태스크가 빠지면 자연 해소되며 데이터 손실은 없다 — 확률·영향이 모두 낮아 **이 컬럼에 한해** 그 잔여 위험을 감수하고 예외를 적용한다. 버릴 데이터를 위해 dual write 코드를 쓰고 지우는 것은 순수 낭비이며 중간 상태에서 컬럼이 둘이라 오히려 혼란스럽다.

이 예외 적용 근거는 마이그레이션 SQL 파일 상단 주석에도 남긴다.

## 변경 내역

### 1. 스키마

`apps/core/src/modules/inventory/schema/inventory.schema.ts`의 `skuBarcodes`를 테이블 확장 콜백 형태로 바꿔 컬럼 타입과 CHECK 제약을 함께 선언한다. `check()`는 이 스키마에서 이미 쓰는 패턴이다(`ck_events_qty_positive`, `ck_locations_system_zone` 등).

```ts
export const skuBarcodes = pgTable('sku_barcodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'cascade' }).notNull(),
  barcode: varchar('barcode', { length: 64 }).notNull().unique(),
  isPrimary: boolean('is_primary').notNull().default(false),
  packingUnit: integer('packing_unit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ckPackingUnitPositive: check(
    'ck_sku_barcodes_packing_unit_positive',
    sql`${t.packingUnit} IS NULL OR ${t.packingUnit} >= 1`,
  ),
}));
```

컬럼은 nullable로 유지한다. 포장단위가 없는 낱개 바코드가 정상 상태이며, SKU 생성 시 자동 생성되는 대표 바코드는 `packing_unit`을 넣지 않는다(`sku-catalog.manager.ts:57`).

### 2. 마이그레이션

```bash
npm run db:generate:core -- --name narrow-packing-unit-to-integer
```

Postgres는 varchar→integer에 등록된 묵시적/대입 캐스트가 없어, 테이블이 텅 비어(전량 NULL) 있어도 `USING` 절 없이는 `ALTER ... SET DATA TYPE`이 거부된다(`column ... cannot be cast automatically to type integer`). drizzle-kit도 이를 알아서, 생성된 SQL은 처음부터 `SET DATA TYPE integer USING "packing_unit"::integer` + `ADD CONSTRAINT`다. **생성 직후 파일 맨 위에 데이터 정리 구문을 손으로 추가**한다:

```sql
-- packing_unit 은 "몇 개입"이라는 숫자인데 컬럼이 varchar(64) 였다.
-- 값이 실무에서 쓰인 적이 없어 전량 폐기하고 타입을 좁힌다.
-- ADR-0005 §5 의 3-PR expand-contract 를 생략한 근거:
-- 버릴 데이터라 손실이 없고, ALTER 직후 컬럼이 전량 NULL 이라
-- 롤링 배포 중 구/신 코드가 무엇을 읽든 null 이다.
UPDATE "sku_barcodes" SET "packing_unit" = NULL WHERE "packing_unit" IS NOT NULL;
```

이 UPDATE로 전량 NULL을 만들어 둔 뒤라, 뒤따르는 `USING "packing_unit"::integer` 캐스트가 숫자 아닌 문자열을 만날 일이 없어 안전하다. CLAUDE.md가 금지하는 것은 *이미 적용된* 마이그레이션 수정이며, 갓 생성한 파일에 데이터 정리 구문을 얹는 것은 정상 절차다.

`schema.ts` + `drizzle/<timestamp>_*.sql` + `drizzle/meta/`는 **한 커밋**에 묶는다.

### 3. 경계 함수 제거

`apps/core/src/modules/inventory/sku-catalog/packing-unit.ts`를 **파일째 삭제**한다. `parsePackingUnit`/`serializePackingUnit`은 "컬럼이 varchar인 한 손으로 'BOX' 같은 값이 들어갈 수 있다"는 전제 위에 있었는데, 이제 DB CHECK가 그것을 막는다. 동반 삭제: `packing-unit.spec.ts`.

호출부는 값을 그대로 통과시킨다.

읽기 5곳 — `packingUnit: b.packingUnit`:
- `sku-catalog/services/sku-catalog.reader.ts:114`
- `sku-catalog/services/sku-catalog.reader.ts:253`
- `sku-catalog/services/sku-catalog.reader.ts:429`
- `sku-catalog/mappers/sku.mapper.ts:11`
- `inbound/services/inbound.service.ts:1140`

쓰기 2곳 — `packingUnit: dto.packingUnit ?? null`:
- `sku-catalog/services/sku-catalog.manager.ts:230`
- `core/services/stock-event.service.ts:69`

### 4. DTO

`AddBarcodeDto.packingUnit`, `CreateStockEntryBySkuIdDto.packingUnit`은 이미 `number` + `@IsInt() @Min(1) @IsOptional()`이다. 여기에 **`@Max(2147483647)`를 추가**한다. int4 상한을 넘는 값이 오면 지금은 DB가 `22003`을 던져 500이 된다. DB의 진실을 DTO에 반영해 400으로 돌려주는 것이 맞다.

### 5. 현장 앱

`native/warehouse-app/src/domains/inbound/packingUnit.ts`의 `scanIncrement`는 **로직 변경 없음**. `typeof unit !== 'number'` / `Number.isSafeInteger` / `< 1` 방어는 DB 제약이 생겨도 유지한다 — API 응답을 신뢰하지 않는 클라이언트 경계 방어라 성격이 다르다.

주석 중 "현재 sku_barcodes.packing_unit 은 전량 NULL 이라 실효 동작은 모두 +1 이다"는 이번 마이그레이션을 가리키도록 갱신한다.

### 6. 손대지 않는 것

`web/df-admin`은 아주 예전 기술실증용으로 잠깐 만든 앱이며 폐기 대상이다(마지막 커밋 2026-05-14). `sku-barcodes-card.tsx:34`가 아직 free-text string을 보내지만 이미 PR #540의 `@IsInt()`로 깨져 있다. **수정 대상이 아니다.**

`apps/admin-web`은 이미 `parsePositiveInt`로 number를 보내고 `number | null`로 받으므로 변경 없다.

## 테스트

TDD 순서로 진행한다.

1. **CHECK 제약 통합 테스트(신규)** — 이 변경의 핵심은 "제약을 코드가 아닌 DB가 지킨다"이므로 그 지점에 테스트를 둔다. 위치는 기존 스키마 통합 테스트와 나란히 `apps/core/src/modules/inventory/schema/sku-barcodes-schema.integration.spec.ts`. `packing_unit`에 `0` / `-1` 삽입이 거부되고 `20` / `NULL`이 통과하는지 고정. 스키마 변경 전에 먼저 빨갛게 만든다.
2. **`add-barcode.dto.spec.ts`** — `@Max` 경계 케이스 추가(`2147483647` 통과, `2147483648` 거부).
3. **`packing-unit.spec.ts` 삭제** — 대상 함수가 사라진다.
4. **회귀** — inventory/fulfillment 통합 테스트에 `packingUnit`을 문자열 리터럴로 넣는 곳은 없음을 확인했다(전수 grep). 앱 테스트(`packingUnit.test.ts`, `QuickInboundScreen.test.tsx`, `PlanReceiveScreen.test.tsx`)는 이미 number/null을 쓰므로 변경 없이 통과해야 한다.

## 배포 런북

**`db:migrate` → `sst deploy` 순서**다(expand 순서).

마이그레이션을 먼저 돌리면 구 태스크는 전량 NULL인 integer 컬럼을 읽어 `null`을 받으므로 안전하다. 순서를 뒤집으면 신 코드가 varchar 문자열을 `number` 선언 자리에서 받아, 앱이 배수를 적용하지 않고 +1로 폴백한다 — 크래시는 아니지만 잘못된 상태이니 순서를 지킨다.

```bash
npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes
# 완료 후
sst deploy
```

- 마이그레이션: 1건
- 신규 SST Secret: 없음
- 신규 환경변수/플래그: 없음
- 앱(warehouse-app) 재배포 필요: 없음. API 계약과 앱 동작이 모두 그대로이며, 앱 쪽 변경은 주석뿐이다.

## 이 스펙이 다루지 않는 것

- 운영에서 실제로 포장단위를 채워 넣는 작업(데이터 입력·운영 정책)
- 대표 바코드에 포장단위를 부여하는 UX
- `packing_unit`을 입고 외 다른 흐름(피킹·출고)에서 활용하는 것
