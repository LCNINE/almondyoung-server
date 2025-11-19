# SKU와 Master 백엔드 흐름 문서

> 이 문서는 다른 프로젝트의 AI Agent가 WMS 백엔드의 SKU와 Master 관련 흐름을 정확히 이해할 수 있도록 작성되었습니다.

## 📋 목차

1. [개요 및 핵심 개념](#개요-및-핵심-개념)
2. [데이터베이스 스키마](#데이터베이스-스키마)
3. [API 엔드포인트](#api-엔드포인트)
4. [서비스 레이어 흐름](#서비스-레이어-흐름)
5. [트랜잭션 처리](#트랜잭션-처리)
6. [PIM 동기화](#pim-동기화)
7. [주요 비즈니스 로직](#주요-비즈니스-로직)
8. [에러 처리](#에러-처리)
9. [코드 예시](#코드-예시)

---

## 개요 및 핵심 개념

### Master (inventory_product_masters)

**Master**는 제품의 그룹 개념입니다. 하나의 Master는 여러 개의 SKU를 가질 수 있습니다.

- **역할**: 제품의 공통 속성과 옵션 스키마를 정의
- **예시**: "아이폰 15 프로"라는 Master는 "256GB / 퍼플", "512GB / 블랙" 등의 여러 SKU를 가질 수 있음
- **특징**:
  - `masterCode`: 고유한 마스터 코드 (예: "M-IPHONE15PRO")
  - `optionSchema`: 옵션 그룹 정의 (DEPRECATED - UI 호환성만 유지)
  - `defaultPolicy`: 기본 정책 설정 (JSON)
  - `status`: 'active' | 'archived'

### SKU (skus)

**SKU**는 실제 재고 관리의 최소 단위입니다. 각 SKU는 반드시 하나의 Master에 속해야 합니다.

- **역할**: 물리적 재고 추적의 기본 단위
- **특징**:
  - `masterId`: 반드시 존재해야 하는 필수 FK (onDelete: 'restrict')
  - `code`: 고유한 SKU 코드 (자동 생성: "P" + 숫자5자리 + 영문3자리)
  - `optionKey`: 옵션 식별자 (1차원 문자열, 예: "M / 블랙")
  - `defaultBarcode`: 기본 바코드 (자동 생성)
  - `(masterId, optionKey)` 유니크 제약으로 동일 Master 내 옵션 조합 중복 방지

### 관계

```
inventory_product_masters (1) ──< (N) skus
```

- 하나의 Master는 여러 SKU를 가질 수 있음
- 하나의 SKU는 반드시 하나의 Master에 속함
- Master 삭제 시 연결된 SKU가 있으면 삭제 불가 (onDelete: 'restrict')

---

## 데이터베이스 스키마

### inventory_product_masters 테이블

```typescript
export const inventoryProductMasters = pgTable(
  'inventory_product_masters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    masterCode: varchar('master_code', { length: 64 }).notNull().unique(),
    optionSchema: json('option_schema'), // DEPRECATED
    defaultPolicy: json('default_policy'),
    status: inventoryMasterStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqMasterCode: unique().on(t.masterCode),
  }),
);
```

**주요 제약조건**:

- `masterCode`는 유니크해야 함
- `id`는 UUID 타입이며, `defaultRandom()`으로 데이터베이스 레벨에서 자동 생성됨 (PostgreSQL의 `gen_random_uuid()` 사용)
  - INSERT 시 `id`를 명시하지 않으면 자동으로 UUID가 생성됨
  - `.returning()`으로 생성된 레코드를 받아 `id`를 사용할 수 있음

### skus 테이블

```typescript
export const skus = pgTable(
  'skus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    holderId: uuid('holder_id')
      .references(() => holders.id, { onDelete: 'cascade' })
      .default('00000000-0000-0000-0000-000000000000')
      .notNull(),
    masterId: uuid('master_id')
      .references(() => inventoryProductMasters.id, { onDelete: 'restrict' })
      .notNull(), // 필수 FK
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 64 }).notNull().unique(),
    optionKey: varchar('option_key', { length: 255 }),
    defaultBarcode: varchar('default_barcode', { length: 64 }),
    stockType: stockTypeEnum('stock_type').notNull().default('physical'),
    deliveryProfileId: uuid('delivery_profile_id').references(
      () => deliveryProfiles.id,
      { onDelete: 'set null' },
    ),
    sale1m: integer('sale_1m'),
    sale3m: integer('sale_3m'),
    safetyStock: integer('safety_stock').notNull().default(0),
    // ... Extended Metadata Fields (40+ 필드)
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqSkuMasterOption: unique().on(t.masterId, t.optionKey), // 동일 Master 내 옵션 조합 중복 방지
    idxSkusSafetyStock: index('idx_skus_safety_stock').on(t.safetyStock),
    // ... 기타 인덱스
  }),
);
```

**주요 제약조건**:

- `code`는 유니크해야 함
- `(masterId, optionKey)` 조합은 유니크해야 함
- `masterId`는 필수이며, Master 삭제 시 제한됨 (restrict)

### 관련 테이블

#### sku_suppliers (N:M 관계)

```typescript
export const skuSuppliers = pgTable(
  'sku_suppliers',
  {
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),
    supplierId: uuid('supplier_id')
      .references(() => suppliers.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.skuId, t.supplierId),
  }),
);
```

#### sku_categories (N:M 관계)

```typescript
export const skuCategories = pgTable(
  'sku_categories',
  {
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),
    categoryId: uuid('category_id')
      .references(() => categories.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.skuId, t.categoryId),
  }),
);
```

---

## API 엔드포인트

### Master API

**Base Path**: `/wms/masters`

#### 1. Master 생성

```http
POST /wms/masters
Content-Type: application/json

{
  "name": "아이폰 15 프로",
  "masterCode": "M-IPHONE15PRO",
  "optionSchema": {
    "options": [
      { "name": "용량", "values": ["256GB", "512GB"] },
      { "name": "색상", "values": ["퍼플", "블랙"] }
    ]
  },
  "defaultPolicy": {
    "autoCreateSkus": true,
    "defaultLocation": "A-01-01"
  }
}
```

**응답**: 생성된 Master 객체

#### 2. Master 수정

```http
PUT /wms/masters/:id
Content-Type: application/json

{
  "name": "아이폰 15 프로 (수정)",
  "status": "active"
}
```

#### 3. Master 삭제

```http
DELETE /wms/masters/:id
```

**제약조건**: 연결된 SKU가 있으면 삭제 불가 (409 Conflict)

#### 4. PIM 동기화 트리거

```http
POST /wms/masters/:id/pim-sync
```

**동작**:

1. Master의 `optionSchema`를 기반으로 PIM에 Master와 Variant 생성
2. 생성된 Variant ID를 `product_matchings` 테이블에 pending 상태로 저장

#### 5. 옵션 스키마 설정/수정

```http
PUT /wms/masters/:id/options
Content-Type: application/json

{
  "options": [
    { "name": "사이즈", "values": ["S", "M", "L"] }
  ]
}
```

#### 6. Master의 SKU 목록 조회

```http
GET /wms/masters/:id/skus
```

**응답**: 해당 Master에 연결된 모든 SKU 목록

### SKU API

**Base Path**: `/wms/inventory/skus`

#### 1. SKU 생성

```http
POST /wms/inventory/skus
Content-Type: application/json

{
  "masterId": "uuid", // 선택: 기존 Master ID
  "masterName": "새 마스터 이름", // 선택: masterId 미지정 시 자동 생성용
  "name": "SKU 이름",
  "optionKey": "M / 블랙",
  "source": "manual_entry", // auto_matching | manual_matching | manual_entry
  "deliveryProfileId": "uuid",
  "sale1m": 100,
  "sale3m": 250,
  "safetyStock": 10,
  "supplierIds": ["uuid1", "uuid2"],
  "categoryIds": ["uuid1"]
}
```

**동작 흐름**:

1. `masterId`가 제공되면 사용, 없으면 `masterName` 또는 `name`으로 새 Master 자동 생성
2. SKU 코드 자동 생성 (`_generateSkuCode()`)
3. 기본 바코드 자동 생성 (`_generateAndSetDefaultBarcode()`)
4. `supplierIds`, `categoryIds`가 있으면 관련 테이블에 레코드 생성

#### 2. SKU 검색

```http
GET /wms/inventory/skus?id=uuid&code=SKU001&barcode=123456&name=상품명&masterId=uuid
```

**쿼리 파라미터**:

- `id`: SKU ID (정확히 일치)
- `code`: SKU 코드 (정확히 일치)
- `barcode`: 기본 바코드 또는 서브 바코드
- `name`: SKU 이름 (부분 일치)
- `supplierName`: 공급사 이름 (부분 일치)
- `masterId`: 마스터 ID (정확히 일치)

#### 3. SKU 상세 조회

```http
GET /wms/inventory/skus/:id
```

**응답**: SKU 정보 + Master 정보 (JOIN)

#### 4. SKU 수정

```http
PUT /wms/inventory/skus/:id
Content-Type: application/json

{
  "name": "수정된 SKU 이름",
  "sale1m": 150,
  "supplierIds": ["uuid1"], // 전체 교체
  "categoryIds": ["uuid2"]  // 전체 교체
}
```

**주의**: `supplierIds`, `categoryIds`는 전체 교체 방식 (기존 삭제 후 재생성)

#### 5. SKU 삭제

```http
DELETE /wms/inventory/skus/:id
```

**제약조건 검사**:

1. 활성 재고가 있으면 삭제 불가
2. `product_matchings`에서 사용 중이면 삭제 불가
3. 활성 예약(`stock_reservations`)이 있으면 삭제 불가

---

## 서비스 레이어 흐름

### MasterService

**파일**: `apps/wms/src/inventory/services/master.service.ts`

#### createMaster()

```typescript
async createMaster(
  params: {
    name: string;
    masterCode: string;
    optionSchema?: OptionSchema;
    defaultPolicy?: Record<string, unknown>;
  },
  tx?: DbTx,
)
```

**흐름**:

1. 트랜잭션 내에서 `inventory_product_masters` 테이블에 INSERT
   - **중요**: INSERT 시 `id`를 명시하지 않음 → 데이터베이스가 `gen_random_uuid()`로 자동 생성
   - `.returning()`으로 생성된 레코드를 받아 `master.id`를 사용
2. 트랜잭션 밖에서 PIM 동기화 (설정된 경우)
   - `PIM_SYNC_ENABLED === 'true'`이면 `syncWithPim()` 호출

#### syncWithPim()

```typescript
async syncWithPim(masterId: string): Promise<{ masterId: string; variants: string[] }>
```

**흐름**:

1. Master 조회
2. `optionSchema`를 기반으로 PIM API 호출
   - `PimOrchestrator.createMasterAndVariants()` 호출
   - PIM에서 Master와 Variant 생성
3. 생성된 Variant ID 목록을 받아옴
4. 각 Variant에 대해 `product_matchings` 테이블에 pending 레코드 생성
   - 기존 레코드가 있으면 skip
   - `strategy`: 옵션이 있으면 'variant', 없으면 'void'

#### deleteMaster()

```typescript
async deleteMaster(masterId: string, tx?: DbTx)
```

**흐름**:

1. 연결된 SKU가 있는지 확인
2. 있으면 에러 발생: "Cannot delete master with linked SKUs"
3. 없으면 삭제

### InventoryService

**파일**: `apps/wms/src/inventory/services/inventory.service.ts`

#### createSku()

```typescript
async createSku(createSkuDto: CreateSkuDto, tx?: DbTx): Promise<SkuResponseDto>
```

**상세 흐름**:

1. **Master 결정**:

   ```typescript
   if (createSkuDto.masterId) {
     masterId = createSkuDto.masterId;
   } else {
     // Master 자동 생성
     const nameForMaster = createSkuDto.masterName ?? createSkuDto.name;
     const masterCode = `M-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
     const [createdMaster] = await trx
       .insert(wmsTables.inventoryProductMasters)
       .values({
         // id는 명시하지 않음 → DB가 gen_random_uuid()로 자동 생성
         name: nameForMaster,
         masterCode,
         status: 'active' as any,
       })
       .returning();
     masterId = createdMaster.id; // 생성된 UUID를 사용
   }
   ```

2. **SKU 생성** (`_createSkuInternal()` 호출):
   - SKU 코드 자동 생성: `P` + 숫자5자리 + 영문3자리
   - SKU 이름 결정:
     - `source === 'auto_matching'`: `"${productName} - ${variantName}"`
     - `source === 'manual_matching'`: `data.name`
     - 그 외: `data.name` 또는 자동 생성
   - 기본 바코드 자동 생성

3. **관련 데이터 생성**:
   - `supplierIds`가 있으면 `sku_suppliers` 테이블에 레코드 생성
   - `categoryIds`가 있으면 `sku_categories` 테이블에 레코드 생성

4. **응답 반환**: `getSkuById()`로 Master 정보 포함하여 반환

#### \_createSkuInternal()

```typescript
async _createSkuInternal(
  data: Omit<CreateSkuDto, 'id' | 'code' | 'defaultBarcode' | 'supplierIds' | 'categoryIds'> & { masterId: string },
  tx: DbTx,
)
```

**역할**: SKU 생성의 내부 로직 (트랜잭션 내부에서만 호출)

**주요 작업**:

1. SKU 코드 생성 (`_generateSkuCode()`)
2. SKU 이름 결정 (source에 따라)
3. `skus` 테이블에 INSERT
4. 기본 바코드 생성 및 설정 (`_generateAndSetDefaultBarcode()`)

#### updateSku()

```typescript
async updateSku(skuId: string, updateSkuDto: UpdateSkuDto, tx?: DbTx): Promise<SkuResponseDto>
```

**흐름**:

1. SKU 기본 정보 업데이트 (`_updateSkuInternal()`)
2. `supplierIds`가 제공되면:
   - 기존 `sku_suppliers` 레코드 삭제
   - 새 레코드 생성 (전체 교체)
3. `categoryIds`가 제공되면:
   - 기존 `sku_categories` 레코드 삭제
   - 새 레코드 생성 (전체 교체)

#### deleteSku()

```typescript
async deleteSku(skuId: string, tx?: DbTx): Promise<void>
```

**검증 단계**:

1. SKU 존재 확인
2. 활성 재고 확인 (`stock_ledgers`에서 `qty > 0`)
3. `product_matchings` 사용 확인 (`product_variant_sku_links`)
4. 활성 예약 확인 (`stock_reservations`에서 `status = 'confirmed'`)
5. 모든 검증 통과 시 삭제

#### getSkuById()

```typescript
async getSkuById(skuId: string, tx?: DbTx): Promise<SkuResponseDto>
```

**특징**: SKU와 Master를 JOIN하여 반환

```sql
SELECT
  s.*,
  m.name as masterName,
  m.masterCode,
  m.optionSchema as masterOptionSchema
FROM skus s
INNER JOIN inventory_product_masters m ON s.master_id = m.id
WHERE s.id = :skuId
```

---

## 트랜잭션 처리

### 트랜잭션 전파 패턴

모든 서비스 메서드는 `tx?: DbTx` 파라미터를 받아 트랜잭션을 전파합니다.

#### inTx 헬퍼

```typescript
private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
}
```

**동작**:

- `tx`가 제공되면 기존 트랜잭션 재사용
- `tx`가 없으면 새 트랜잭션 시작

#### 사용 예시

```typescript
// 상위에서 트랜잭션 시작
await this.db.transaction(async (trx) => {
    const master = await this.masterService.createMaster({ ... }, trx);
    const sku = await this.inventoryService.createSku({ masterId: master.id, ... }, trx);
    // 두 작업이 하나의 트랜잭션으로 처리됨
});

// 트랜잭션 없이 호출
const sku = await this.inventoryService.createSku({ ... });
// 내부에서 새 트랜잭션 시작
```

### 트랜잭션 경계

#### Master 생성 시

```typescript
async createMaster(params, tx?: DbTx) {
    // 1) 내부 저장 (트랜잭션)
    const master = await this.inTx(async (trx) => {
        const [created] = await trx.insert(...).values(...).returning();
        return created;
    }, tx);

    // 2) 외부 호출 (트랜잭션 밖)
    if (pimEnabled) {
        await this.syncWithPim(master.id); // PIM API 호출은 트랜잭션 밖
    }

    return master;
}
```

**이유**: PIM API 호출은 외부 서비스이므로 트랜잭션 밖에서 처리

#### SKU 생성 시

```typescript
async createSku(createSkuDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
        // Master 결정/생성
        // SKU 생성
        // Supplier/Category 연결
        // 모든 작업이 하나의 트랜잭션으로 처리
    }, tx);
}
```

---

## PIM 동기화

### 개요

PIM(Product Information Management) 서비스와 WMS의 Master/Variant를 동기화하는 메커니즘입니다.

### 동기화 흐름

#### 1. Master 생성 시 자동 동기화

```typescript
// master.service.ts - createMaster()
const pimEnabled = this.configService.get('PIM_SYNC_ENABLED') === 'true';
if (pimEnabled) {
  await this.syncWithPim(master.id);
}
```

#### 2. 수동 동기화 트리거

```http
POST /wms/masters/:id/pim-sync
```

#### 3. syncWithPim() 상세 흐름

```typescript
async syncWithPim(masterId: string) {
    // 1. Master 조회
    const master = await this.db.query.inventoryProductMasters.findFirst({ ... });

    // 2. optionSchema 변환
    const optionSchema = (master.optionSchema || { options: [] }) as OptionSchema;
    const input = {
        name: master.name,
        pricingStrategy: 'variant_based',
        basePrice: 0,
        optionGroups: (optionSchema.options || []).map((o) => ({
            name: o.name,
            values: o.values.map((v) => ({ value: v, displayName: v })),
        })),
    };

    // 3. PIM API 호출
    const { masterId: pimMasterId } = await orchestrator.createMasterAndVariants(input, {
        idempotencyKey: `wms-${masterId}`,
    });

    // 4. PIM에서 생성된 Variant 목록 조회
    const detail = await client.getMasterDetail(pimMasterId);
    const variantIds = detail?.variants?.map((v: any) => v.id) || [];

    // 5. product_matchings 테이블에 pending 레코드 생성
    for (const variantId of variantIds) {
        const existing = await trx.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.variantId, variantId),
        });
        if (existing) continue; // 이미 존재하면 skip

        await trx.insert(wmsTables.productMatchings).values({
            variantId,
            masterId,
            status: 'pending',
            priority: 'normal',
            strategy: (optionSchema.options?.length ?? 0) > 0 ? 'variant' : 'void',
            isResolved: false,
        });
    }

    return { masterId, variants: variantIds };
}
```

### product_matchings 테이블

PIM의 Variant와 WMS의 Master/SKU를 연결하는 매핑 테이블입니다.

```typescript
export const productMatchings = pgTable(
  'product_matchings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    masterId: uuid('master_id').references(() => inventoryProductMasters.id, {
      onDelete: 'set null',
    }),
    status: matchingStatusEnum('status').notNull().default('pending'), // pending | matched | ignored
    priority: matchingPriorityEnum('priority').notNull().default('normal'),
    strategy: matchingStrategyEnum('strategy'), // void | variant
    isResolved: boolean('is_resolved').notNull().default(false),
    inventoryManagement: boolean('inventory_management')
      .notNull()
      .default(false),
    preStockSellable: boolean('pre_stock_sellable').notNull().default(true),
    alwaysSellableZeroStock: boolean('always_sellable_zero_stock')
      .notNull()
      .default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueVariantId: unique().on(t.variantId), // variant당 하나의 매칭만 존재
  }),
);
```

---

## 주요 비즈니스 로직

### SKU 코드 생성

```typescript
private _generateSkuCode(): string {
    const prefix = 'P';
    const numericPart = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const alphaPart = Array.from({ length: 3 }, () =>
        String.fromCharCode(65 + Math.floor(Math.random() * 26))
    ).join('');
    return `${prefix}${numericPart}${alphaPart}`;
}
```

**예시**: `P12345ABC`, `P00001XYZ`

### 기본 바코드 생성

```typescript
async _generateAndSetDefaultBarcode(skuId: string, tx: DbTx): Promise<string>
```

**동작**:

1. 고유한 바코드 생성
2. `sku_barcodes` 테이블에 레코드 생성
3. `skus.defaultBarcode` 업데이트

### SKU 이름 결정 로직

```typescript
let skuName: string;
if (data.source === SkuCreationSource.AUTO_MATCHING) {
  skuName = `${data.productName || 'Unknown Product'} - ${data.variantName || 'Unknown Variant'}`;
} else if (data.source === SkuCreationSource.MANUAL_MATCHING) {
  skuName = data.name;
} else {
  skuName = data.name || `Auto-generated SKU Name (${skuCode})`;
}
```

### Master 자동 생성 로직

SKU 생성 시 `masterId`가 없으면 자동으로 Master를 생성합니다.

```typescript
if (!createSkuDto.masterId) {
  const nameForMaster = createSkuDto.masterName ?? createSkuDto.name;
  const masterCode = `M-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const [createdMaster] = await trx
    .insert(wmsTables.inventoryProductMasters)
    .values({
      name: nameForMaster,
      masterCode,
      status: 'active' as any,
    })
    .returning();
  masterId = createdMaster.id;
}
```

---

## 에러 처리

### 에러 처리 규칙

서비스 레이어에서는 `throw new Error("...")`로 명확한 메시지만 던집니다.

컨트롤러 레이어에서 문자열 패턴 기반으로 HTTP 상태 코드를 매핑합니다.

### 주요 에러 케이스

#### Master 관련

1. **Master 삭제 시 연결된 SKU 존재**
   ```typescript
   throw new Error('Cannot delete master with linked SKUs');
   ```
   → 컨트롤러에서 409 Conflict로 변환

#### SKU 관련

1. **SKU 삭제 시 활성 재고 존재**

   ```typescript
   throw new ConflictException(
     `Cannot delete SKU ${skuId}: Has active stock of ${totalStock} units.`,
   );
   ```

   → 409 Conflict

2. **SKU 삭제 시 product_matchings 사용 중**

   ```typescript
   throw new ConflictException(
     `Cannot delete SKU ${skuId}: Used in ${matchings.length} product matching(s).`,
   );
   ```

   → 409 Conflict

3. **SKU 삭제 시 활성 예약 존재**

   ```typescript
   throw new ConflictException(
     `Cannot delete SKU ${skuId}: Has ${reservations.length} active reservation(s).`,
   );
   ```

   → 409 Conflict

4. **SKU 조회 시 존재하지 않음**
   ```typescript
   throw new NotFoundException(`SKU with ID ${skuId} not found`);
   ```
   → 404 Not Found

### 컨트롤러 에러 매핑

컨트롤러는 `events-exception.filter.ts`를 통해 에러를 변환합니다.

```typescript
// 에러 메시지 패턴 기반 매핑
if (error.message.includes('not found')) {
  return 404;
}
if (
  error.message.includes('already processed') ||
  error.message.includes('exceeds') ||
  error.message.includes('required') ||
  error.message.includes('invalid') ||
  error.message.includes('failed')
) {
  return 400;
}
// 그 외는 500
```

---

## 코드 예시

### Master 생성 후 SKU 생성

```typescript
// 1. Master 생성
const master = await this.masterService.createMaster({
  name: '아이폰 15 프로',
  masterCode: 'M-IPHONE15PRO',
  optionSchema: {
    options: [
      { name: '용량', values: ['256GB', '512GB'] },
      { name: '색상', values: ['퍼플', '블랙'] },
    ],
  },
});

// 2. SKU 생성 (같은 트랜잭션)
await this.db.transaction(async (trx) => {
  const sku1 = await this.inventoryService.createSku(
    {
      masterId: master.id,
      name: '아이폰 15 프로 - 256GB 퍼플',
      optionKey: '256GB / 퍼플',
      source: 'manual_entry',
    },
    trx,
  );

  const sku2 = await this.inventoryService.createSku(
    {
      masterId: master.id,
      name: '아이폰 15 프로 - 512GB 블랙',
      optionKey: '512GB / 블랙',
      source: 'manual_entry',
    },
    trx,
  );
});
```

### Master 없이 SKU 생성 (자동 Master 생성)

```typescript
const sku = await this.inventoryService.createSku({
  masterName: '새로운 제품', // 또는 생략 시 SKU name 사용
  name: 'SKU 이름',
  optionKey: 'M / 블랙',
  source: 'manual_entry',
});
// 내부에서 Master가 자동 생성됨
```

### PIM 동기화 후 SKU 매칭

```typescript
// 1. Master 생성 및 PIM 동기화
const master = await this.masterService.createMaster({ ... });
// PIM_SYNC_ENABLED=true이면 자동으로 syncWithPim() 호출

// 2. 수동 동기화 트리거 (선택)
await this.masterService.syncWithPim(master.id);

// 3. product_matchings에서 pending 레코드 확인
const matchings = await this.db.query.productMatchings.findMany({
    where: eq(wmsTables.productMatchings.masterId, master.id),
    where: eq(wmsTables.productMatchings.status, 'pending'),
});

// 4. 매칭 처리 (ProductMatchingService 사용)
for (const matching of matchings) {
    // 매칭 로직 실행
}
```

### SKU 검색 및 조회

```typescript
// 단순 검색
const skus = await this.inventoryService.searchSkus({
  masterId: master.id,
  name: '아이폰',
});

// 상세 조회 (Master 정보 포함)
const sku = await this.inventoryService.getSkuById(skuId);
// 응답: { id, name, code, masterId, masterName, masterCode, ... }

// Master의 모든 SKU 조회
const masterSkus = await this.masterService.getSkusByMaster(master.id);
```

### SKU 수정 (Supplier/Category 교체)

```typescript
await this.inventoryService.updateSku(skuId, {
  name: '수정된 이름',
  sale1m: 150,
  supplierIds: ['new-supplier-id'], // 기존 supplierIds 전체 삭제 후 재생성
  categoryIds: ['new-category-id'], // 기존 categoryIds 전체 삭제 후 재생성
});
```

---

## 요약

### 핵심 포인트

1. **Master는 SKU의 그룹**: 하나의 Master는 여러 SKU를 가질 수 있음
2. **SKU는 반드시 Master에 속함**: `masterId`는 필수 FK
3. **트랜잭션 전파**: 모든 서비스 메서드는 `tx?: DbTx` 파라미터로 트랜잭션 전파
4. **자동 생성**: SKU 생성 시 Master가 없으면 자동 생성
5. **PIM 동기화**: Master 생성 시 PIM과 동기화하여 `product_matchings`에 pending 레코드 생성
6. **제약조건**: Master 삭제 시 연결된 SKU가 있으면 불가, SKU 삭제 시 재고/매칭/예약 확인

### 파일 위치

- **Master 서비스**: `apps/wms/src/inventory/services/master.service.ts`
- **SKU 서비스**: `apps/wms/src/inventory/services/inventory.service.ts`
- **Master 컨트롤러**: `apps/wms/src/inventory/controllers/masters.controller.ts`
- **SKU 컨트롤러**: `apps/wms/src/inventory/controllers/inventory.controller.ts`
- **스키마**: `apps/wms/database/schemas/wms-schema.ts`
- **DTO**: `apps/wms/src/inventory/dto/master/`, `apps/wms/src/inventory/dto/sku/`

---

이 문서는 WMS 백엔드의 SKU와 Master 관련 흐름을 정확히 이해하기 위한 참고 자료입니다. 추가 질문이나 수정 사항이 있으면 알려주세요.
