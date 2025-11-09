# WMS 옵션 구조 개편 구현 계획

## 문서 정보
- **작성일**: 2025-01-09
- **대상 시스템**: Almondyoung WMS
- **개편 범위**: 조합형 옵션 → 1차원 옵션 구조 전환
- **전제 조건**: ⚡ 개발 단계, 과감한 Breaking Change 허용

---

## 📋 목차
1. [개요](#개요)
2. [전제 조건 및 개편 원칙](#전제-조건-및-개편-원칙)
3. [단계별 구현 계획](#단계별-구현-계획)
4. [상세 구현 가이드](#상세-구현-가이드)
5. [검증 체크리스트](#검증-체크리스트)
6. [긴급 롤백 가이드](#긴급-롤백-가이드)

---

## 개요

### 현재 문제
```typescript
// ❌ 현재: WMS가 PIM의 조합형 옵션을 그대로 사용
skus.optionKey = { "사이즈": "S", "색상": "검정" }  // JSONB

문제점:
1. PIM variant 변경 시 SKU 삭제/재생성 필요
2. stock_events 이력 손실 위험
3. 재고 연속성 파괴
4. 도메인 책임 혼재 (WMS가 PIM 로직 이해)
```

### 개편 목표
```typescript
// ✅ 목표: 1차원 식별자로 단순화
skus.optionKey = "S/검정"  // VARCHAR(255)

이점:
1. SKU 영속성 보장 (절대 삭제 안 함)
2. stock_events 이력 완벽 보존
3. WMS-PIM 도메인 분리 명확화
4. 물류팀 직관성 향상
```

### 예상 소요 시간
**총 3일** (개발 단계 과감한 작업 기준)

---

## 전제 조건 및 개편 원칙

### ⚡ 개발 단계 전제
1. **Breaking Change 허용**: API 호환성 무시 가능
2. **기존 데이터 폐기 가능**: 프로덕션 데이터 없음
3. **빠른 실행 우선**: 완벽한 마이그레이션보다 빠른 개편
4. **롤백 계획 간소화**: 최소한의 백업만 유지

### 🎯 핵심 원칙
1. **SKU 삭제 금지**: 한번 생성된 SKU는 영구 유지
2. **간결한 스키마**: 복잡한 호환성 레이어 불필요
3. **과감한 제거**: 불필요한 코드/테이블 즉시 삭제
4. **테스트 우선**: 구현 전 실패 테스트 작성

---

## 단계별 구현 계획

### 🗓️ Day 1: 스키마 및 코드 제거

#### ⏰ AM (4시간)
- [x] **Step 1.1**: 현황 파악 및 백업 (30분)
- [x] **Step 1.2**: 불필요한 코드 완전 제거 (2시간)
- [x] **Step 1.3**: 스키마 수정 (1.5시간)

#### ⏰ PM (4시간)
- [x] **Step 1.4**: DTO 타입 수정 (1시간)
- [x] **Step 1.5**: 서비스 로직 수정 (2시간)
- [x] **Step 1.6**: 컴파일 확인 및 빌드 (1시간)

### 🗓️ Day 2: 데이터베이스 및 테스트

#### ⏰ AM (4시간)
- [x] **Step 2.1**: 마이그레이션 스크립트 작성 (1시간)
- [x] **Step 2.2**: 로컬 DB 마이그레이션 실행 (30분)
- [x] **Step 2.3**: 단위 테스트 작성 (2.5시간)

#### ⏰ PM (4시간)
- [x] **Step 2.4**: 통합 테스트 작성 (2시간)
- [x] **Step 2.5**: E2E 테스트 작성 (1.5시간)
- [x] **Step 2.6**: 전체 테스트 실행 및 수정 (30분)

### 🗓️ Day 3: 검증 및 문서화

#### ⏰ AM (4시간)
- [x] **Step 3.1**: API 수동 테스트 (1.5시간)
- [x] **Step 3.2**: 성능 검증 (1시간)
- [x] **Step 3.3**: 아키텍처 문서 갱신 (1.5시간)

#### ⏰ PM (4시간)
- [x] **Step 3.4**: API 문서 및 CHANGELOG 작성 (1.5시간)
- [x] **Step 3.5**: 최종 검증 (1시간)
- [x] **Step 3.6**: Git 커밋 및 배포 준비 (1.5시간)

---

## 상세 구현 가이드

### 📦 Day 1: 스키마 및 코드 제거

---

#### Step 1.1: 현황 파악 및 백업 (30분)

**작업 내용:**
```bash
# 1. Git 브랜치 생성
git checkout -b feat/wms-1d-option-key
git add .
git commit -m "chore: checkpoint before option migration"

# 2. 현황 확인 쿼리 실행
npm run db:studio.wms
```

**DB 현황 확인 SQL:**
```sql
-- SKU 통계
SELECT
  COUNT(*) as total_skus,
  COUNT(option_key) as skus_with_option
FROM skus;

-- 옵션 타입 분포
SELECT
  jsonb_typeof(option_key) as option_type,
  COUNT(*) as count
FROM skus
WHERE option_key IS NOT NULL
GROUP BY jsonb_typeof(option_key);

-- Matching 전략 분포
SELECT strategy, COUNT(*) as count
FROM product_matchings
WHERE strategy IS NOT NULL
GROUP BY strategy;
```

**백업 (선택사항):**
```bash
# 개발 단계이므로 간단한 덤프만
pg_dump -h localhost -U postgres -d almondyoung_wms \
  -t skus -t inventory_product_masters \
  > backup_option_migration_$(date +%Y%m%d).sql
```

**체크포인트:**
- [ ] Git 브랜치 생성 완료
- [ ] 현재 SKU 개수 파악 (___개)
- [ ] Option 전략 사용 여부 확인 (___건)

---

#### Step 1.2: 불필요한 코드 완전 제거 (2시간)

**⚡ 개발 단계 과감한 삭제!**

##### 1.2.1 OptionEngineService 모듈 삭제

```bash
# 전체 모듈 삭제
rm -rf libs/shared/src/option-engine/

# package.json 확인 (shared 라이브러리이므로 별도 패키지 없음)
```

##### 1.2.2 OptionMatchingStrategy 삭제

```bash
# 전략 파일 삭제
rm apps/wms/src/inventory/strategies/option-matching.strategy.ts
```

##### 1.2.3 MasterService에서 generateSkusFromOptions 제거

**파일**: `apps/wms/src/inventory/services/master.service.ts`

```typescript
// ❌ 삭제할 코드 (대략 137-154줄)
/*
async generateSkusFromOptions(masterId: string, tx?: DbTx) {
  return this.inTx(async (trx) => {
    const master = await trx.query.inventoryProductMasters.findFirst({
      where: eq(wmsTables.inventoryProductMasters.id, masterId)
    });
    if (!master) return [];
    const schema = (master.optionSchema || { options: [] }) as OptionSchema;
    const combos = this.optionEngine.generateCombinations(schema);

    const createdSkuIds: string[] = [];
    for (const combo of combos) {
      const existing = await trx.query.skus.findFirst({
        where: and(
          eq(wmsTables.skus.masterId, masterId),
          eq(wmsTables.skus.optionKey, combo as any)
        )
      });
      if (existing) continue;
      const skuName = `${master.name} ${Object.values(combo).join(' / ')}`;
      const sku = await this.inventoryService.createSku({
        name: skuName,
        masterId,
        optionKey: combo as any
      } as any, trx);
      createdSkuIds.push(sku.id);
    }
    return createdSkuIds;
  }, tx);
}
*/
// ← 위 전체 메서드 삭제
```

**Import 정리:**
```typescript
// Before
import { OptionEngineService, OptionSchema } from '@shared/option-engine';

@Injectable()
export class MasterService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DbConnection,
    private readonly inventoryService: InventoryService,
    private readonly optionEngine: OptionEngineService,  // ← 삭제
  ) {}
}

// After
// import { OptionEngineService, OptionSchema } from '@shared/option-engine';  // ← 삭제

@Injectable()
export class MasterService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DbConnection,
    private readonly inventoryService: InventoryService,
    // optionEngine 제거
  ) {}
}
```

##### 1.2.4 MasterController에서 엔드포인트 제거

**파일**: `apps/wms/src/inventory/controllers/master.controller.ts`

```typescript
// ❌ 삭제할 엔드포인트
/*
@Post(':id/generate-skus')
@ApiOperation({ summary: '마스터의 옵션 조합으로 SKU 자동 생성' })
async generateSkus(@Param('id') id: string) {
  const skuIds = await this.masterService.generateSkusFromOptions(id);
  return {
    message: `Generated ${skuIds.length} SKUs`,
    skuIds,
  };
}
*/
// ← 위 전체 메서드 삭제
```

##### 1.2.5 InventoryModule에서 제거

**파일**: `apps/wms/src/inventory/inventory.module.ts`

```typescript
// Before
import { OptionEngineModule } from '@shared/option-engine';
import { OptionMatchingStrategy } from './strategies/option-matching.strategy';

@Module({
  imports: [
    DbModule.forRoot(),
    OptionEngineModule,  // ← 삭제
    // ...
  ],
  providers: [
    // ...
    VoidMatchingStrategy,
    VariantMatchingStrategy,
    OptionMatchingStrategy,  // ← 삭제
    // ...
  ],
})

// After
// import { OptionEngineModule } from '@shared/option-engine';  // ← 삭제
// import { OptionMatchingStrategy } from './strategies/option-matching.strategy';  // ← 삭제

@Module({
  imports: [
    DbModule.forRoot(),
    // OptionEngineModule 제거
    // ...
  ],
  providers: [
    // ...
    VoidMatchingStrategy,
    VariantMatchingStrategy,
    // OptionMatchingStrategy 제거
    // ...
  ],
})
```

##### 1.2.6 ProductMatchingService 정리

**파일**: `apps/wms/src/inventory/services/product-matching.service.ts`

```typescript
// Before
import { OptionMatchingStrategy } from '../strategies/option-matching.strategy';

export class ProductMatchingService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DbConnection,
    private readonly voidStrategy: VoidMatchingStrategy,
    private readonly variantStrategy: VariantMatchingStrategy,
    private readonly optionStrategy: OptionMatchingStrategy,  // ← 삭제
  ) {}

  private getStrategy(strategyType: MatchingStrategyType): MatchingStrategy {
    switch (strategyType) {
      case 'void':
        return this.voidStrategy;
      case 'variant':
        return this.variantStrategy;
      case 'option':  // ← 삭제
        return this.optionStrategy;
      default:
        throw new Error(`Unknown strategy type: ${strategyType}`);
    }
  }
}

// After
// import { OptionMatchingStrategy } from '../strategies/option-matching.strategy';  // ← 삭제

export class ProductMatchingService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DbConnection,
    private readonly voidStrategy: VoidMatchingStrategy,
    private readonly variantStrategy: VariantMatchingStrategy,
    // optionStrategy 제거
  ) {}

  private getStrategy(strategyType: MatchingStrategyType): MatchingStrategy {
    switch (strategyType) {
      case 'void':
        return this.voidStrategy;
      case 'variant':
        return this.variantStrategy;
      default:
        throw new Error(
          `Unsupported strategy: ${strategyType}. Only 'void' and 'variant' are supported.`
        );
    }
  }
}
```

**체크포인트:**
- [ ] `libs/shared/src/option-engine/` 폴더 삭제 완료
- [ ] `option-matching.strategy.ts` 파일 삭제 완료
- [ ] `MasterService.generateSkusFromOptions` 메서드 제거
- [ ] `MasterController` 엔드포인트 제거
- [ ] `InventoryModule` import/provider 정리
- [ ] `ProductMatchingService` 정리 완료

---

#### Step 1.3: 스키마 수정 (1.5시간)

##### 1.3.1 SKU 스키마 수정

**파일**: `apps/wms/database/schemas/wms-schema.ts`

**변경 위치**: 대략 306-390줄

```typescript
// Before (JSONB)
export const skus = pgTable('skus', {
  id: uuid('id').primaryKey().defaultRandom(),
  holderId: uuid('holder_id')
    .references(() => holders.id, { onDelete: 'cascade' })
    .default("00000000-0000-0000-0000-000000000000")
    .notNull(),
  masterId: uuid('master_id')
    .references(() => inventoryProductMasters.id, { onDelete: 'restrict' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  optionKey: jsonb('option_key'),  // ← 변경
  defaultBarcode: varchar('default_barcode', { length: 64 }),
  deliveryProfileId: uuid('delivery_profile_id').references(() => deliveryProfiles.id, {
    onDelete: 'set null',
  }),
  sale1m: integer('sale_1m').default(0),
  sale3m: integer('sale_3m').default(0),
  safetyStock: integer('safety_stock').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uqSkuMasterOption: unique().on(t.masterId, t.optionKey),
  idxSkuCode: index('idx_sku_code').on(t.code),
  idxSkuMaster: index('idx_sku_master').on(t.masterId),
  idxSkuBarcode: index('idx_sku_barcode').on(t.defaultBarcode),
}));

// After (VARCHAR)
export const skus = pgTable('skus', {
  id: uuid('id').primaryKey().defaultRandom(),
  holderId: uuid('holder_id')
    .references(() => holders.id, { onDelete: 'cascade' })
    .default("00000000-0000-0000-0000-000000000000")
    .notNull(),
  masterId: uuid('master_id')
    .references(() => inventoryProductMasters.id, { onDelete: 'restrict' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  optionKey: varchar('option_key', { length: 255 }),  // ← VARCHAR로 변경
  defaultBarcode: varchar('default_barcode', { length: 64 }),
  deliveryProfileId: uuid('delivery_profile_id').references(() => deliveryProfiles.id, {
    onDelete: 'set null',
  }),
  sale1m: integer('sale_1m').default(0),
  sale3m: integer('sale_3m').default(0),
  safetyStock: integer('safety_stock').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uqSkuMasterOption: unique().on(t.masterId, t.optionKey),
  idxSkuCode: index('idx_sku_code').on(t.code),
  idxSkuMaster: index('idx_sku_master').on(t.masterId),
  idxSkuBarcode: index('idx_sku_barcode').on(t.defaultBarcode),
}));
```

##### 1.3.2 product_option_matchings 테이블 정의 제거

**파일**: `apps/wms/database/schemas/wms-schema.ts`

**변경 위치**: 대략 868-882줄

```typescript
// ❌ 삭제할 코드
/*
export const productOptionMatchings = pgTable('product_option_matchings', {
  id: uuid('id').primaryKey().defaultRandom(),
  productMatchingId: uuid('product_matching_id')
    .references(() => productMatchings.id, { onDelete: 'cascade' })
    .notNull(),
  optionName: varchar('option_name', { length: 255 }).notNull(),
  optionValue: varchar('option_value', { length: 255 }).notNull(),
  skuId: uuid('sku_id')
    .references(() => skus.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uniqueOptionMatching: unique().on(t.productMatchingId, t.optionName, t.optionValue),
}));
*/
// ← 위 전체 테이블 정의 삭제
```

**Relations도 제거:**
```typescript
// ❌ 삭제
/*
export const productOptionMatchingsRelations = relations(productOptionMatchings, ({ one }) => ({
  productMatching: one(productMatchings, {
    fields: [productOptionMatchings.productMatchingId],
    references: [productMatchings.id],
  }),
  sku: one(skus, {
    fields: [productOptionMatchings.skuId],
    references: [skus.id],
  }),
}));
*/
```

##### 1.3.3 Matching Strategy Enum 수정

**파일**: `apps/wms/database/schemas/wms-schema.ts`

**변경 위치**: enum 정의 부분

```typescript
// Before
export const matchingStrategyEnum = pgEnum('matching_strategy', [
  'void',
  'variant',
  'option',  // ← 삭제
]);

// After
export const matchingStrategyEnum = pgEnum('matching_strategy', [
  'void',
  'variant',
]);
```

##### 1.3.4 inventoryProductMasters optionSchema 주석 추가

**파일**: `apps/wms/database/schemas/wms-schema.ts`

```typescript
export const inventoryProductMasters = pgTable('inventory_product_masters', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  masterCode: varchar('master_code', { length: 64 }).notNull(),
  // DEPRECATED: WMS는 더 이상 옵션 조합을 생성하지 않음
  // UI 호환성을 위해 유지, 향후 제거 예정
  optionSchema: json('option_schema'),
  defaultPolicy: json('default_policy'),
  status: inventoryMasterStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  uqMasterCode: unique().on(t.masterCode),
}));
```

**체크포인트:**
- [ ] `skus.optionKey`: jsonb → varchar(255) 변경
- [ ] `productOptionMatchings` 테이블 정의 제거
- [ ] `matchingStrategyEnum`에서 'option' 제거
- [ ] `optionSchema` 주석 추가

---

#### Step 1.4: DTO 타입 수정 (1시간)

##### 1.4.1 CreateSkuDto

**파일**: `apps/wms/src/inventory/dto/sku/create-sku.dto.ts`

**변경 위치**: 대략 26-28줄

```typescript
// Before
@ApiProperty({
  description: '옵션 조합 키 (예: {"색상":"퍼플","용량":"256GB"})',
  required: false,
  type: Object
})
@IsOptional()
optionKey?: Record<string, string>;

// After
@ApiProperty({
  description: '옵션 식별자 (1차원 문자열)',
  required: false,
  type: String,
  example: "S / 검정",
  examples: {
    simple: {
      value: "M / 블랙",
      summary: "사이즈와 색상"
    },
    complex: {
      value: "256GB / 퍼플 / Wi-Fi",
      summary: "용량, 색상, 연결"
    },
    none: {
      value: null,
      summary: "옵션 없음"
    }
  }
})
@IsOptional()
@IsString()
@MaxLength(255)
optionKey?: string;
```

**Import 추가:**
```typescript
import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsEnum,
  Min,
  MaxLength,  // ← 추가
  ValidateNested,
  IsArray,
} from 'class-validator';
```

##### 1.4.2 SkuResponseDto

**파일**: `apps/wms/src/inventory/dto/sku/sku-response.dto.ts`

**변경 위치**: 대략 46-47줄

```typescript
// Before
@ApiProperty({ required: false, type: Object })
optionKey?: Record<string, string>;

// After
@ApiProperty({
  required: false,
  type: String,
  description: '옵션 식별자',
  example: "M / 흰색"
})
optionKey?: string | null;
```

##### 1.4.3 UpdateSkuDto

**파일**: `apps/wms/src/inventory/dto/sku/update-sku.dto.ts`

```typescript
// Before
@ApiProperty({
  description: '옵션 조합 키',
  required: false,
  type: Object
})
@IsOptional()
optionKey?: Record<string, string>;

// After
@ApiProperty({
  description: '옵션 식별자 (예: "L / 빨강")',
  required: false,
  type: String
})
@IsOptional()
@IsString()
@MaxLength(255)
optionKey?: string;
```

##### 1.4.4 CreateMasterDto (Deprecated 표시)

**파일**: `apps/wms/src/inventory/dto/master/create-master.dto.ts`

```typescript
// optionSchema 필드에 deprecated 추가
@ApiProperty({
  description: 'DEPRECATED: WMS는 더 이상 옵션 조합을 생성하지 않음. UI 호환성만 유지.',
  required: false,
  type: Object,
  deprecated: true,
  example: {
    options: [
      { name: "사이즈", values: ["S", "M", "L"] }
    ]
  }
})
@IsOptional()
optionSchema?: any;
```

**체크포인트:**
- [ ] `CreateSkuDto.optionKey`: Record → string
- [ ] `SkuResponseDto.optionKey`: Record → string | null
- [ ] `UpdateSkuDto.optionKey`: Record → string
- [ ] `CreateMasterDto.optionSchema`: deprecated 표시
- [ ] Import에 `MaxLength` 추가

---

#### Step 1.5: 서비스 로직 수정 (2시간)

##### 1.5.1 InventoryService._createSkuInternal

**파일**: `apps/wms/src/inventory/services/inventory.service.ts`

**변경 위치**: 대략 950-987줄

```typescript
async _createSkuInternal(
  data: Omit<CreateSkuDto, 'id' | 'code' | 'defaultBarcode' | 'supplierIds' | 'categoryIds'> & { masterId: string },
  tx: DbTx,
) {
  const db = tx;
  const skuCode = this._generateSkuCode();

  let skuName: string;
  if (data.source === SkuCreationSource.AUTO_MATCHING) {
    skuName = `${data.productName || 'Unknown Product'} - ${data.variantName || 'Unknown Variant'}`;
  } else if (data.source === SkuCreationSource.MANUAL_MATCHING) {
    skuName = data.name;
  } else {
    skuName = data.name || `Auto-generated SKU Name (${skuCode})`;
  }

  const [newSku] = await db.insert(wmsTables.skus).values({
    masterId: data.masterId,
    name: skuName,
    code: skuCode,
    optionKey: data.optionKey ?? null,  // ← string | null (before: Record<string, string>)
    deliveryProfileId: data.deliveryProfileId,
    sale1m: data.sale1m,
    sale3m: data.sale3m,
    safetyStock: data.safetyStock ?? 0,
  }).returning();

  if (!newSku) {
    throw new Error('Failed to create SKU internally');
  }

  const generatedBarcode = await this._generateAndSetDefaultBarcode(newSku.id, db);
  newSku.defaultBarcode = generatedBarcode;

  this.logger.log(
    `SKU created internally: ${newSku.id} (Name: ${newSku.name}, OptionKey: ${newSku.optionKey || 'N/A'})`
  );
  return newSku;
}
```

**변경 사항:**
- `optionKey: (data as any).optionKey as any` → `optionKey: data.optionKey ?? null`
- 로그 메시지에 optionKey 추가 (디버깅 편의)

##### 1.5.2 기타 서비스 메서드 확인

**파일**: `apps/wms/src/inventory/services/inventory.service.ts`

다음 메서드들은 Drizzle 타입 추론에 의해 자동으로 `string | null` 타입 적용됨:
- `getSku()` - 조회 시 optionKey 자동 타입 반영
- `updateSku()` - 업데이트 시 string 허용
- `getSkus()` - 목록 조회 시 자동 반영

**추가 수정 불필요 (타입 변경만으로 충분)**

##### 1.5.3 MasterService 최종 정리

**파일**: `apps/wms/src/inventory/services/master.service.ts`

**Import 정리:**
```typescript
// ❌ 제거
// import { OptionEngineService, OptionSchema } from '@shared/option-engine';

// ✅ 유지
import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DB_TOKEN, DbConnection } from '../../database/db.module';
import * as wmsTables from '../../database/schemas/wms-schema';
import { DbTx } from '../../database/schemas/wms-schema';
import { CreateMasterDto } from '../dto/master/create-master.dto';
import { UpdateMasterDto } from '../dto/master/update-master.dto';
// ... 기타 필요한 import만 유지
```

**Constructor 정리:**
```typescript
// Before
constructor(
  @Inject(DB_TOKEN) private readonly db: DbConnection,
  private readonly inventoryService: InventoryService,
  private readonly optionEngine: OptionEngineService,  // ← 삭제
) {}

// After
constructor(
  @Inject(DB_TOKEN) private readonly db: DbConnection,
  private readonly inventoryService: InventoryService,
  // optionEngine 제거
) {}
```

**체크포인트:**
- [ ] `_createSkuInternal`: optionKey 타입 정리
- [ ] `MasterService`: import/constructor 정리
- [ ] 기타 서비스 메서드 타입 확인

---

#### Step 1.6: 컴파일 확인 및 빌드 (1시간)

```bash
# 1. TypeScript 타입 체크
npx tsc --noEmit

# 예상 에러:
# - OptionEngineService 관련 import 에러
# - optionKey 타입 불일치 에러
# → 모두 수정했으면 에러 없어야 함

# 2. 전체 빌드
npm run build

# 3. WMS 빌드
npm run build:wms

# 4. Drizzle 타입 재생성 (스키마 변경 반영)
npm run db:generate.wms
```

**예상 컴파일 에러 및 해결:**

**에러 1: OptionEngineModule을 찾을 수 없음**
```
Error: Cannot find module '@shared/option-engine'
```
**해결**: `InventoryModule`에서 import 제거 확인

**에러 2: optionKey 타입 불일치**
```
Type 'Record<string, string>' is not assignable to type 'string'
```
**해결**: DTO와 스키마 타입 일치 확인

**에러 3: generateSkusFromOptions 호출**
```
Property 'generateSkusFromOptions' does not exist
```
**해결**: Controller에서 엔드포인트 제거 확인

**체크포인트:**
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `npm run build` 성공
- [ ] `npm run build:wms` 성공
- [ ] `npm run db:generate.wms` 완료

---

### 📦 Day 2: 데이터베이스 및 테스트

---

#### Step 2.1: 마이그레이션 스크립트 작성 (1시간)

##### 2.1.1 Drizzle 마이그레이션 생성

```bash
# 스키마 변경사항 마이그레이션 생성
npm run db:generate.wms
```

**생성된 파일 확인:**
- `apps/wms/database/migrations/0001_*.sql` (자동 생성)

##### 2.1.2 수동 마이그레이션 SQL 작성

**⚡ 개발 단계: 기존 데이터 폐기 가능**

**파일**: `apps/wms/database/migrations/manual_0001_option_key_migration.sql`

```sql
-- ============================================
-- WMS 옵션 키 1차원 구조 전환 마이그레이션
-- 개발 단계: 기존 데이터 폐기 방식
-- ============================================

BEGIN;

-- Step 1: product_option_matchings 테이블 삭제 (먼저 FK 제거)
DROP TABLE IF EXISTS product_option_matchings CASCADE;

-- Step 2: matching_strategy enum 재생성
-- (PostgreSQL enum은 값 제거 불가하므로 재생성)
ALTER TYPE matching_strategy RENAME TO matching_strategy_old;
CREATE TYPE matching_strategy AS ENUM ('void', 'variant');

-- Step 3: product_matchings 테이블의 enum 컬럼 변환
-- Option 전략 사용 중인 매칭 확인 (개발 단계이므로 삭제 허용)
DELETE FROM product_matchings WHERE strategy = 'option';

-- Enum 타입 변경
ALTER TABLE product_matchings
  ALTER COLUMN strategy TYPE matching_strategy
  USING strategy::text::matching_strategy;

DROP TYPE matching_strategy_old;

-- Step 4: skus 테이블 optionKey 변경
-- ⚡ 개발 단계: 기존 데이터 폐기 (간단한 방법)
ALTER TABLE skus DROP COLUMN option_key;
ALTER TABLE skus ADD COLUMN option_key VARCHAR(255);

-- Unique 제약 재생성
CREATE UNIQUE INDEX skus_master_id_option_key_unique
  ON skus(master_id, option_key)
  WHERE option_key IS NOT NULL;

-- Step 5: optionSchema에 deprecated 주석
COMMENT ON COLUMN inventory_product_masters.option_schema IS
  'DEPRECATED: WMS no longer generates SKU combinations. Keep for UI compatibility only.';

-- Step 6: 마이그레이션 로그
CREATE TABLE IF NOT EXISTS migration_logs (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT
);

INSERT INTO migration_logs (migration_name, notes) VALUES
  ('0001_option_key_to_varchar', 'Converted optionKey from JSONB to VARCHAR(255) - DEV MODE: data dropped');

COMMIT;

-- ============================================
-- 검증 쿼리
-- ============================================

-- optionKey 타입 확인
SELECT
  column_name,
  data_type,
  character_maximum_length
FROM information_schema.columns
WHERE table_name = 'skus' AND column_name = 'option_key';
-- 예상: data_type = 'character varying', length = 255

-- product_option_matchings 제거 확인
SELECT COUNT(*) FROM product_option_matchings;
-- 예상: ERROR - relation does not exist

-- matching_strategy enum 확인
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'matching_strategy'::regtype;
-- 예상: 'void', 'variant' (option 없음)
```

**대안: 데이터 보존 버전 (필요 시)**

<details>
<summary>📦 클릭하여 데이터 보존 마이그레이션 보기</summary>

```sql
-- 기존 데이터를 보존하는 마이그레이션 (프로덕션용)
BEGIN;

-- Step 1: 백업 컬럼 추가
ALTER TABLE skus ADD COLUMN option_key_backup JSONB;
UPDATE skus SET option_key_backup = option_key;

-- Step 2: 새 VARCHAR 컬럼 추가
ALTER TABLE skus ADD COLUMN option_key_new VARCHAR(255);

-- Step 3: 데이터 변환
UPDATE skus
SET option_key_new = CASE
  WHEN option_key IS NULL THEN NULL
  WHEN jsonb_typeof(option_key) = 'string' THEN
    TRIM(BOTH '"' FROM option_key::text)
  WHEN jsonb_typeof(option_key) = 'object' THEN (
    SELECT string_agg(value, ' / ' ORDER BY key)
    FROM jsonb_each_text(option_key)
  )
  ELSE NULL
END;

-- Step 4: 컬럼 교체
ALTER TABLE skus DROP COLUMN option_key;
ALTER TABLE skus RENAME COLUMN option_key_new TO option_key;

-- Step 5: Unique 제약 재생성
CREATE UNIQUE INDEX skus_master_id_option_key_unique
  ON skus(master_id, option_key)
  WHERE option_key IS NOT NULL;

COMMIT;
```

</details>

**체크포인트:**
- [ ] `manual_0001_option_key_migration.sql` 파일 작성
- [ ] Drizzle 마이그레이션 파일 생성 확인

---

#### Step 2.2: 로컬 DB 마이그레이션 실행 (30분)

```bash
# 1. 현재 DB 상태 백업 (선택사항)
pg_dump -h localhost -U postgres -d almondyoung_wms \
  > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql

# 2. Drizzle Push (스키마 변경 적용)
npm run db:push.wms

# 3. 수동 마이그레이션 실행 (enum, 테이블 삭제 등)
psql -h localhost -U postgres -d almondyoung_wms \
  -f apps/wms/database/migrations/manual_0001_option_key_migration.sql
```

**실행 후 검증:**

```sql
-- 1. optionKey 타입 확인
\d skus

-- 예상 결과:
-- option_key | character varying(255)

-- 2. Unique 제약 확인
\d skus

-- 예상 결과:
-- Indexes:
--   "skus_master_id_option_key_unique" UNIQUE, btree (master_id, option_key) WHERE option_key IS NOT NULL

-- 3. product_option_matchings 제거 확인
SELECT * FROM product_option_matchings;

-- 예상 결과:
-- ERROR:  relation "product_option_matchings" does not exist

-- 4. matching_strategy enum 확인
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'matching_strategy'::regtype ORDER BY enumlabel;

-- 예상 결과:
-- variant
-- void
```

**Drizzle Studio로 시각적 확인:**

```bash
npm run db:studio.wms
```

- `skus` 테이블 확인
- `option_key` 컬럼 타입 확인 (text여야 함)
- 데이터 샘플 확인

**체크포인트:**
- [ ] `npm run db:push.wms` 성공
- [ ] 수동 마이그레이션 실행 성공
- [ ] optionKey 타입이 VARCHAR(255)
- [ ] product_option_matchings 테이블 제거됨
- [ ] matching_strategy enum에 'option' 없음

---

#### Step 2.3: 단위 테스트 작성 (2.5시간)

##### 2.3.1 InventoryService 테스트

**파일**: `apps/wms/src/inventory/services/inventory.service.spec.ts`

**추가할 테스트:**

```typescript
describe('InventoryService - 1D Option Key', () => {
  let service: InventoryService;
  let db: DbConnection;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DbModule.forRoot(),
        // ... 기타 모듈
      ],
      providers: [InventoryService],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    db = module.get<DbConnection>(DB_TOKEN);
  });

  describe('createSku with string optionKey', () => {
    it('should create SKU with string optionKey', async () => {
      const dto: CreateSkuDto = {
        name: "테스트 SKU",
        optionKey: "S / 검정",
      };

      const result = await service.createSku(dto);

      expect(result.optionKey).toBe("S / 검정");
      expect(typeof result.optionKey).toBe("string");
    });

    it('should create SKU without optionKey', async () => {
      const dto: CreateSkuDto = {
        name: "옵션 없는 SKU",
      };

      const result = await service.createSku(dto);

      expect(result.optionKey).toBeNull();
    });

    it('should enforce max length 255', async () => {
      const longOption = "A".repeat(256);

      await expect(
        service.createSku({
          name: "긴 옵션 SKU",
          optionKey: longOption,
        })
      ).rejects.toThrow();
    });

    it('should enforce unique constraint on (masterId, optionKey)', async () => {
      // 1. Master 생성
      const master = await db.insert(wmsTables.inventoryProductMasters).values({
        name: "테스트 마스터",
        masterCode: "TEST-001",
        status: 'active',
      }).returning();

      // 2. 첫 번째 SKU 생성
      await service.createSku({
        name: "First SKU",
        masterId: master[0].id,
        optionKey: "M / 블루",
      });

      // 3. 같은 optionKey로 재생성 시도
      await expect(
        service.createSku({
          name: "Duplicate SKU",
          masterId: master[0].id,
          optionKey: "M / 블루",  // ← 중복
        })
      ).rejects.toThrow(/unique constraint/i);
    });

    it('should allow same optionKey for different masters', async () => {
      // 다른 마스터는 같은 optionKey 허용
      const master1 = await createTestMaster("Master 1");
      const master2 = await createTestMaster("Master 2");

      const sku1 = await service.createSku({
        name: "SKU 1",
        masterId: master1.id,
        optionKey: "M / 검정",
      });

      const sku2 = await service.createSku({
        name: "SKU 2",
        masterId: master2.id,
        optionKey: "M / 검정",  // ← 같은 optionKey, 다른 master
      });

      expect(sku1.id).not.toBe(sku2.id);
      expect(sku1.optionKey).toBe(sku2.optionKey);
    });
  });

  describe('updateSku optionKey', () => {
    it('should update optionKey to new string value', async () => {
      const sku = await createTestSku({ optionKey: "S / 빨강" });

      const updated = await service.updateSku(sku.id, {
        optionKey: "M / 파랑",
      });

      expect(updated.optionKey).toBe("M / 파랑");
    });

    it('should clear optionKey when set to null', async () => {
      const sku = await createTestSku({ optionKey: "L / 그린" });

      const updated = await service.updateSku(sku.id, {
        optionKey: null,
      });

      expect(updated.optionKey).toBeNull();
    });

    it('should reject object optionKey', async () => {
      const sku = await createTestSku();

      await expect(
        service.updateSku(sku.id, {
          optionKey: { "size": "M" } as any,  // ← 객체
        })
      ).rejects.toThrow();
    });
  });

  describe('getSku', () => {
    it('should return SKU with string optionKey', async () => {
      const created = await createTestSku({ optionKey: "XL / 옐로우" });

      const retrieved = await service.getSku(created.id);

      expect(retrieved.optionKey).toBe("XL / 옐로우");
      expect(typeof retrieved.optionKey).toBe("string");
    });
  });
});

// Helper functions
async function createTestMaster(name: string) {
  const [master] = await db.insert(wmsTables.inventoryProductMasters).values({
    name,
    masterCode: `TEST-${Date.now()}`,
    status: 'active',
  }).returning();
  return master;
}

async function createTestSku(options?: { optionKey?: string | null }) {
  const master = await createTestMaster("Test Master");
  const [sku] = await db.insert(wmsTables.skus).values({
    masterId: master.id,
    name: "Test SKU",
    code: `SKU-${Date.now()}`,
    optionKey: options?.optionKey ?? null,
    safetyStock: 0,
  }).returning();
  return sku;
}
```

##### 2.3.2 MasterService 테스트

**파일**: `apps/wms/src/inventory/services/master.service.spec.ts`

```typescript
describe('MasterService - Post Migration', () => {
  let service: MasterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DbModule.forRoot()],
      providers: [MasterService, InventoryService],
    }).compile();

    service = module.get<MasterService>(MasterService);
  });

  it('should create master with optionSchema (deprecated but allowed)', async () => {
    const dto: CreateMasterDto = {
      name: "테스트 마스터",
      masterCode: "TEST-001",
      optionSchema: {
        options: [
          { name: "사이즈", values: ["S", "M"] }
        ]
      },
    };

    const result = await service.createMaster(dto);

    expect(result.optionSchema).toBeDefined();
    // optionSchema는 저장되지만 사용되지 않음
  });

  it('should NOT have generateSkusFromOptions method', () => {
    expect((service as any).generateSkusFromOptions).toBeUndefined();
  });

  it('should NOT have optionEngine dependency', () => {
    expect((service as any).optionEngine).toBeUndefined();
  });
});
```

##### 2.3.3 ProductMatchingService 테스트

**파일**: `apps/wms/src/inventory/services/product-matching.service.spec.ts`

```typescript
describe('ProductMatchingService - Strategy', () => {
  let service: ProductMatchingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DbModule.forRoot()],
      providers: [
        ProductMatchingService,
        VoidMatchingStrategy,
        VariantMatchingStrategy,
        // OptionMatchingStrategy 제거됨
      ],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);
  });

  it('should support void strategy', () => {
    const strategy = (service as any).getStrategy('void');
    expect(strategy).toBeDefined();
    expect(strategy.constructor.name).toBe('VoidMatchingStrategy');
  });

  it('should support variant strategy', () => {
    const strategy = (service as any).getStrategy('variant');
    expect(strategy).toBeDefined();
    expect(strategy.constructor.name).toBe('VariantMatchingStrategy');
  });

  it('should reject option strategy', () => {
    expect(() => {
      (service as any).getStrategy('option');
    }).toThrow(/unsupported strategy/i);
  });

  it('should reject unknown strategy', () => {
    expect(() => {
      (service as any).getStrategy('unknown' as any);
    }).toThrow(/unsupported strategy/i);
  });
});
```

**체크포인트:**
- [ ] InventoryService 테스트 작성 (7개 이상)
- [ ] MasterService 테스트 작성 (3개)
- [ ] ProductMatchingService 테스트 작성 (4개)

---

#### Step 2.4: 통합 테스트 작성 (2시간)

**파일**: `apps/wms/test/integration/sku-option-key.integration.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbConnection, DB_TOKEN } from '../../src/database/db.module';
import { InventoryService } from '../../src/inventory/services/inventory.service';
import * as wmsTables from '../../src/database/schemas/wms-schema';
import { eq } from 'drizzle-orm';

describe('SKU Option Key Integration Test', () => {
  let app: TestingModule;
  let db: DbConnection;
  let inventoryService: InventoryService;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [DbModule.forRoot()],
      providers: [InventoryService],
    }).compile();

    db = app.get<DbConnection>(DB_TOKEN);
    inventoryService = app.get<InventoryService>(InventoryService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CRUD with string optionKey', () => {
    it('should create, read, update, delete SKU with optionKey', async () => {
      // 1. Create
      const created = await inventoryService.createSku({
        name: "통합 테스트 SKU",
        optionKey: "M / 블랙",
      });

      expect(created.optionKey).toBe("M / 블랙");

      // 2. Read
      const read = await inventoryService.getSku(created.id);
      expect(read.optionKey).toBe("M / 블랙");

      // 3. Update
      const updated = await inventoryService.updateSku(created.id, {
        optionKey: "L / 화이트",
      });
      expect(updated.optionKey).toBe("L / 화이트");

      // 4. Delete
      await inventoryService.deleteSku(created.id);

      const deleted = await db.query.skus.findFirst({
        where: eq(wmsTables.skus.id, created.id),
      });
      expect(deleted).toBeUndefined();
    });
  });

  describe('Unique constraint enforcement', () => {
    it('should prevent duplicate (masterId, optionKey)', async () => {
      const master = await createTestMaster(db);

      // 첫 번째 SKU 생성
      await inventoryService.createSku({
        name: "First",
        masterId: master.id,
        optionKey: "S / 레드",
      });

      // 중복 시도
      await expect(
        inventoryService.createSku({
          name: "Duplicate",
          masterId: master.id,
          optionKey: "S / 레드",  // ← 중복
        })
      ).rejects.toThrow(/unique/i);
    });

    it('should allow NULL optionKey multiple times for same master', async () => {
      const master = await createTestMaster(db);

      const sku1 = await inventoryService.createSku({
        name: "No Option 1",
        masterId: master.id,
        optionKey: null,
      });

      const sku2 = await inventoryService.createSku({
        name: "No Option 2",
        masterId: master.id,
        optionKey: null,  // ← NULL은 중복 허용
      });

      expect(sku1.id).not.toBe(sku2.id);
    });
  });

  describe('Database type validation', () => {
    it('should store optionKey as VARCHAR in database', async () => {
      const sku = await inventoryService.createSku({
        name: "타입 테스트",
        optionKey: "XL / 그린",
      });

      // 직접 DB 쿼리로 타입 확인
      const result = await db.execute(sql`
        SELECT
          pg_typeof(option_key) as option_type,
          option_key
        FROM skus
        WHERE id = ${sku.id}
      `);

      expect(result.rows[0].option_type).toBe('character varying');
      expect(result.rows[0].option_key).toBe('XL / 그린');
    });
  });
});

// Helper
async function createTestMaster(db: DbConnection) {
  const [master] = await db.insert(wmsTables.inventoryProductMasters).values({
    name: "Integration Test Master",
    masterCode: `INT-${Date.now()}`,
    status: 'active',
  }).returning();
  return master;
}
```

**체크포인트:**
- [ ] CRUD 통합 테스트 작성
- [ ] Unique 제약 통합 테스트 작성
- [ ] 데이터베이스 타입 검증 테스트 작성

---

#### Step 2.5: E2E 테스트 작성 (1.5시간)

**파일**: `apps/wms/test/e2e/option-key-migration.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Option Key Migration E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/wms/inventory/skus', () => {
    it('should accept string optionKey', () => {
      return request(app.getHttpServer())
        .post('/api/wms/inventory/skus')
        .send({
          name: "E2E 테스트 SKU",
          optionKey: "XL / 블랙",
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.optionKey).toBe("XL / 블랙");
          expect(typeof res.body.optionKey).toBe("string");
        });
    });

    it('should reject object optionKey', () => {
      return request(app.getHttpServer())
        .post('/api/wms/inventory/skus')
        .send({
          name: "잘못된 요청",
          optionKey: { "사이즈": "M" },  // ← object
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('optionKey');
        });
    });

    it('should accept null optionKey', () => {
      return request(app.getHttpServer())
        .post('/api/wms/inventory/skus')
        .send({
          name: "옵션 없는 SKU",
          optionKey: null,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.optionKey).toBeNull();
        });
    });

    it('should reject optionKey longer than 255 chars', () => {
      const longOption = "A".repeat(256);

      return request(app.getHttpServer())
        .post('/api/wms/inventory/skus')
        .send({
          name: "긴 옵션 SKU",
          optionKey: longOption,
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toContain('maxLength');
        });
    });
  });

  describe('PATCH /api/wms/inventory/skus/:id', () => {
    it('should update optionKey to new string', async () => {
      // 1. SKU 생성
      const createRes = await request(app.getHttpServer())
        .post('/api/wms/inventory/skus')
        .send({ name: "업데이트 테스트", optionKey: "S / 레드" })
        .expect(201);

      const skuId = createRes.body.id;

      // 2. optionKey 업데이트
      return request(app.getHttpServer())
        .patch(`/api/wms/inventory/skus/${skuId}`)
        .send({ optionKey: "M / 블루" })
        .expect(200)
        .expect((res) => {
          expect(res.body.optionKey).toBe("M / 블루");
        });
    });
  });

  describe('DELETE /api/wms/inventory/masters/:id/generate-skus', () => {
    it('should return 404 (endpoint removed)', () => {
      return request(app.getHttpServer())
        .post('/api/wms/inventory/masters/some-uuid/generate-skus')
        .expect(404);
    });
  });

  describe('Product Matching with Variant Strategy', () => {
    it('should match PIM variant to WMS SKU with string optionKey', async () => {
      // 1. SKU 생성
      const skuRes = await request(app.getHttpServer())
        .post('/api/wms/inventory/skus')
        .send({
          name: "매칭 테스트 SKU",
          optionKey: "M / 화이트",
        })
        .expect(201);

      // 2. PIM variant 추가 이벤트 시뮬레이션 (실제 구현에 따라 조정)
      // (Product Matching API 사용)

      // 3. 매칭 검증
      // (구현에 따라 검증 로직 추가)

      expect(skuRes.body.optionKey).toBe("M / 화이트");
    });
  });

  describe('Swagger API Documentation', () => {
    it('should serve updated API docs', () => {
      return request(app.getHttpServer())
        .get('/api/docs')
        .expect(200);
    });

    it('should show optionKey as string in schema', async () => {
      const docsRes = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const schema = docsRes.body.components.schemas.CreateSkuDto;
      expect(schema.properties.optionKey.type).toBe('string');
    });
  });
});
```

**체크포인트:**
- [ ] SKU CRUD E2E 테스트 작성
- [ ] 제거된 엔드포인트 404 테스트 작성
- [ ] Swagger 문서 검증 테스트 작성

---

#### Step 2.6: 전체 테스트 실행 및 수정 (30분)

```bash
# 1. 단위 테스트 실행
npm run wms:test

# 2. 커버리지 확인
npm run test:cov

# 3. E2E 테스트 실행
npm run test:e2e

# 4. 특정 테스트 파일만 실행 (디버깅)
npm run wms:test -- inventory.service.spec.ts
npm run wms:test -- master.service.spec.ts
```

**실패 시 디버깅:**

```bash
# 디버그 모드로 테스트 실행
npm run wms:test:debug
```

**예상 실패 케이스 및 해결:**

1. **타입 불일치 에러**
   - DTO 타입과 스키마 타입 재확인
   - Drizzle 타입 재생성: `npm run db:generate.wms`

2. **Unique 제약 위반**
   - 테스트 간 데이터 격리 확인
   - `beforeEach`에서 테이블 정리

3. **Import 에러**
   - 삭제된 모듈 import 잔존 확인
   - `OptionEngineService` 등

**체크포인트:**
- [ ] 모든 단위 테스트 통과
- [ ] 모든 통합 테스트 통과
- [ ] 모든 E2E 테스트 통과
- [ ] 커버리지 85% 이상

---

### 📦 Day 3: 검증 및 문서화

---

#### Step 3.1: API 수동 테스트 (1.5시간)

##### 3.1.1 로컬 서버 시작

```bash
# 개발 모드로 WMS 시작
npm run start:wms:dev
```

##### 3.1.2 Swagger UI 확인

브라우저에서 `http://localhost:3000/api/docs` 접속

**확인 사항:**
- [ ] `POST /api/wms/inventory/skus`
  - Request Body에서 `optionKey`가 `string` 타입
  - Example 값이 "M / 블랙" 형태
- [ ] `PATCH /api/wms/inventory/skus/{id}`
  - `optionKey` 업데이트 가능
- [ ] ~~`POST /api/wms/inventory/masters/{id}/generate-skus`~~
  - 엔드포인트 목록에 없어야 함

##### 3.1.3 cURL 테스트

**SKU 생성 (string optionKey):**
```bash
curl -X POST http://localhost:3000/api/wms/inventory/skus \
  -H "Content-Type: application/json" \
  -d '{
    "name": "테스트 SKU",
    "optionKey": "M / 블랙"
  }'

# 예상 응답:
# {
#   "id": "uuid",
#   "name": "테스트 SKU",
#   "code": "SKU-ABC123",
#   "optionKey": "M / 블랙",
#   ...
# }
```

**SKU 생성 (object optionKey - 실패해야 함):**
```bash
curl -X POST http://localhost:3000/api/wms/inventory/skus \
  -H "Content-Type: application/json" \
  -d '{
    "name": "잘못된 SKU",
    "optionKey": {"size": "M"}
  }'

# 예상 응답:
# {
#   "statusCode": 400,
#   "message": ["optionKey must be a string"],
#   "error": "Bad Request"
# }
```

**SKU 업데이트:**
```bash
curl -X PATCH http://localhost:3000/api/wms/inventory/skus/{sku-id} \
  -H "Content-Type: application/json" \
  -d '{
    "optionKey": "L / 화이트"
  }'
```

**제거된 엔드포인트 호출:**
```bash
curl -X POST http://localhost:3000/api/wms/inventory/masters/some-uuid/generate-skus

# 예상 응답:
# {
#   "statusCode": 404,
#   "message": "Cannot POST /api/wms/inventory/masters/some-uuid/generate-skus",
#   "error": "Not Found"
# }
```

##### 3.1.4 Postman/Insomnia 테스트

**Collection 생성:**
1. `POST /skus` - string optionKey
2. `POST /skus` - null optionKey
3. `POST /skus` - object optionKey (400 예상)
4. `PATCH /skus/:id` - optionKey 업데이트
5. `DELETE /masters/:id/generate-skus` - 404 예상

**체크포인트:**
- [ ] Swagger UI 확인 완료
- [ ] cURL 테스트 5개 이상 통과
- [ ] Postman/Insomnia Collection 생성

---

#### Step 3.2: 성능 검증 (1시간)

##### 3.2.1 인덱스 성능 확인

```sql
-- 1. optionKey로 검색 성능
EXPLAIN ANALYZE
SELECT * FROM skus
WHERE master_id = 'some-uuid' AND option_key = 'M / 블랙';

-- 예상 실행 계획:
-- Index Scan using skus_master_id_option_key_unique
-- Planning Time: < 1ms
-- Execution Time: < 1ms

-- 2. optionKey LIKE 검색 (필요 시)
EXPLAIN ANALYZE
SELECT * FROM skus
WHERE option_key LIKE '%블랙%';

-- Full Table Scan (정상, LIKE는 인덱스 미사용)

-- 3. GIN 인덱스 추가 고려 (필요 시)
CREATE INDEX idx_skus_option_key_gin ON skus USING gin(option_key gin_trgm_ops);
-- (pg_trgm 확장 필요)
```

##### 3.2.2 Bulk Insert 성능 테스트

```typescript
// apps/wms/test/performance/bulk-insert.perf.ts
describe('Bulk Insert Performance', () => {
  it('should insert 1000 SKUs in < 5 seconds', async () => {
    const master = await createTestMaster();
    const start = Date.now();

    const skus = Array.from({ length: 1000 }, (_, i) => ({
      masterId: master.id,
      name: `SKU ${i}`,
      code: `SKU-${i}`,
      optionKey: `${i % 10} / ${i % 5}`,  // ← string
      safetyStock: 0,
    }));

    await db.insert(wmsTables.skus).values(skus);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);  // 5초 이내
  });
});
```

```bash
# 성능 테스트 실행
npm run wms:test -- bulk-insert.perf.ts
```

##### 3.2.3 JSONB vs VARCHAR 비교

**JSONB (Before):**
- 저장 공간: ~50 bytes ({"사이즈":"M","색상":"블랙"})
- 인덱싱: GIN 인덱스 필요 (크기 큼)
- 쿼리: `option_key @> '{"사이즈":"M"}'::jsonb`

**VARCHAR (After):**
- 저장 공간: ~20 bytes ("M / 블랙")
- 인덱싱: B-tree 인덱스 (효율적)
- 쿼리: `option_key = 'M / 블랙'`

**결론**: VARCHAR가 단순 조회에서 더 효율적

**체크포인트:**
- [ ] 인덱스 실행 계획 확인
- [ ] Bulk Insert 성능 테스트 통과
- [ ] JSONB vs VARCHAR 비교 문서화

---

#### Step 3.3: 아키텍처 문서 갱신 (1.5시간)

##### 3.3.1 pim-wms-option-architecture.md 수정

**파일**: `docs/pim-wms-option-architecture.md`

**변경 사항:**

1. **WMS 옵션 구조 섹션 업데이트 (라인 140-260)**

```markdown
## WMS 옵션 구조

### 설계 철학: **1차원 식별자 (One-Dimensional Identifier)** ✅ 구현 완료 (2025-01-09)

WMS의 관점에서 옵션은 **조합의 의미가 없습니다**. 물류팀에게는:
- "S/검정 티셔츠"
- "M/흰색 티셔츠"
- "키보드"

이 세 가지가 **동등하게 다른 물건**일 뿐입니다.

### 데이터 구조

```typescript
// skus
{
  id: uuid,
  masterId: uuid,
  name: string,
  code: string,
  optionKey: string,  // ✅ 1차원 식별자 (예: "S/검정")
  defaultBarcode: string,
  // ...
}

// inventory_product_masters
{
  id: uuid,
  name: string,
  masterCode: string,
  optionSchema: json,  // DEPRECATED: UI 호환성만 유지
  defaultPolicy: json,
  status: 'active' | 'inactive'
}
```

### ~~optionKey 개편 계획~~ → ✅ 개편 완료 (2025-01-09)

#### ~~현재 (조합형 - 제거 예정)~~ → 제거 완료
```json
// Before (removed 2025-01-09)
{
  "Color": "Red",
  "Size": "M"
}
```

#### ✅ 개편 후 (1차원 식별자) - 현재 구조
```json
"S/검정"
```

**타입**: `VARCHAR(255)`
**형식**: 자유 형식 문자열
**예시**:
- `"S / 검정"`
- `"256GB / 퍼플 / Wi-Fi"`
- `null` (옵션 없음)
```

2. **Product Matching 섹션 업데이트 (라인 300-385)**

```markdown
### 매칭 전략 (Strategy Pattern)

#### 1. **Void 전략**
(내용 동일)

#### 2. **Variant 전략** (권장)
(내용 동일)

#### ~~3. **Option 전략** (개편 예정)~~ → ✅ 제거 완료 (2025-01-09)

Option 전략은 2025-01-09 개편으로 제거되었습니다.

**제거 사유:**
- 1차원 optionKey 구조와 불일치
- WMS가 PIM의 조합 개념을 이해하는 것은 도메인 침범
- 모든 실물 상품은 Variant 전략으로 통합 가능

**마이그레이션:**
- 기존 Option 전략 사용 중인 매칭 → Variant 전략으로 전환
- `product_option_matchings` 테이블 제거

### 전략 선택 가이드 (갱신)

| 상품 유형 | 전략 | 이유 |
|----------|------|------|
| 단일 실물 상품 | variant | 1:1 매핑, 단순 명확 |
| 세트/번들 상품 | variant | 구성품별 재고 차감 |
| 디지털 상품 | void | 재고 관리 불필요 |
| 직배송 상품 | void | 무한 재고 가정 |
| ~~옵션별 분리~~ | ~~option~~ | ✅ 제거됨 (2025-01-09) |
```

3. **요약 섹션 업데이트 (라인 715-743)**

```markdown
## 요약

### PIM (판매상품)
- **목적**: 고객에게 선택 가능한 조합 제공
- **구조**: 정규화된 3단계 옵션 구조
- **변경 시**: Variant 전체 재생성 (조합 변경)
- **안전성**: FK 제약, Cascade 삭제, Unique 제약

### WMS (재고상품) ✅ 개편 완료 (2025-01-09)
- **목적**: 물리적 재고 추적 및 관리
- **구조**: 1차원 optionKey (VARCHAR, 조합 의미 없음)
- **변경 시**: SKU 유지, 매칭만 업데이트
- **안전성**: 재고 연속성, 이벤트 소싱 무결성

### Product Matching (연결 레이어)
- **목적**: PIM 변동성 흡수, WMS 안정성 보장
- **전략**: void (디지털), variant (모든 실물 상품)
- **동기화**: 이벤트 기반 (DELETED → 매칭 정리, ADDED → 대기 등록)

### 핵심 원칙
1. **독립성**: 각 시스템은 자신의 도메인에 최적화
2. **연속성**: SKU는 영구 존속, 재고 이력 보존
3. **유연성**: ~~전략 패턴으로 다양한 상품 유형 대응~~ → Variant/Void 두 전략으로 단순화

---

**문서 버전**: 2.0
**최종 수정**: 2025-01-09 (옵션 개편 완료)
**작성자**: System Architecture Team
```

##### 3.3.2 마이그레이션 문서 작성

**파일**: `docs/migrations/0001-option-key-to-varchar.md`

```markdown
# Migration 0001: Option Key to VARCHAR

## 개요
- **일자**: 2025-01-09
- **목적**: WMS 옵션 키를 조합형(JSONB)에서 1차원(VARCHAR) 구조로 전환
- **영향도**: 🔴 High (Breaking Changes)
- **개발 단계**: 기존 데이터 폐기 방식 적용

## 변경 사항

### Database
- `skus.option_key`: JSONB → VARCHAR(255)
- `product_option_matchings`: 테이블 삭제
- `matching_strategy`: enum에서 'option' 값 제거

### Application
- DTO: `optionKey` 타입 `Record<string, string>` → `string`
- Service: `MasterService.generateSkusFromOptions()` 메서드 제거
- Strategy: `OptionMatchingStrategy` 제거
- Module: `OptionEngineService` 제거

### API
- 제거: `POST /api/wms/inventory/masters/:id/generate-skus`
- 수정: SKU 생성/수정 시 `optionKey`는 문자열만 허용

## 실행 방법

```bash
# 1. Git 체크아웃
git checkout feat/wms-1d-option-key

# 2. 의존성 설치
npm install

# 3. 빌드
npm run build:wms

# 4. 마이그레이션 실행
npm run db:push.wms
psql -h localhost -U postgres -d almondyoung_wms \
  -f apps/wms/database/migrations/manual_0001_option_key_migration.sql

# 5. 검증
npm run wms:test
```

## 검증

```sql
-- optionKey 타입 확인
\d skus
-- 예상: option_key | character varying(255)

-- product_option_matchings 제거 확인
SELECT * FROM product_option_matchings;
-- 예상: ERROR - relation does not exist

-- matching_strategy enum 확인
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'matching_strategy'::regtype;
-- 예상: 'variant', 'void' (option 없음)
```

## 롤백 (개발 단계: 권장하지 않음)

개발 단계이므로 롤백보다 Git 리셋 권장:

```bash
git reset --hard <이전-커밋>
npm run build:wms
npm run db:push.wms
```

## 주의사항
- ⚠️ Breaking Change: API 클라이언트 코드 수정 필요
- ⚠️ `generateSkusFromOptions` 호출 코드 모두 제거 필요
- ✅ 개발 단계이므로 기존 데이터 보존 불필요

---

**작성자**: Development Team
**검토일**: 2025-01-09
```

**체크포인트:**
- [ ] `pim-wms-option-architecture.md` 갱신 완료
- [ ] `0001-option-key-to-varchar.md` 작성 완료

---

#### Step 3.4: API 문서 및 CHANGELOG 작성 (1.5시간)

##### 3.4.1 CHANGELOG.md 업데이트

**파일**: `CHANGELOG.md`

```markdown
# Changelog

## [Unreleased]

### 🔴 Breaking Changes (2025-01-09)

#### WMS 옵션 구조 1차원 전환
- **[WMS]** `skus.optionKey` 타입 변경: `JSONB` → `VARCHAR(255)`
  - Before: `{"사이즈":"M","색상":"블랙"}` (객체)
  - After: `"M / 블랙"` (문자열)
- **[WMS]** SKU DTO에서 `optionKey`는 이제 `string | null` 타입만 허용
  - CreateSkuDto, UpdateSkuDto, SkuResponseDto 모두 적용
- **[WMS]** `POST /api/wms/inventory/masters/:id/generate-skus` 엔드포인트 제거
  - WMS는 더 이상 SKU를 자동 생성하지 않음
  - PIM에서 variant 생성 후 Product Matching으로 수동 매칭 필요
- **[WMS]** Product Matching에서 'option' 전략 제거
  - 지원 전략: `void` (디지털), `variant` (실물) 두 가지만
  - 기존 option 전략 사용 중인 매칭은 variant로 전환 필요

### ✨ Added
- **[Docs]** WMS 옵션 구조 개편 가이드 문서 추가
  - `docs/wms-option-migration-implementation-plan.md`
  - `docs/migrations/0001-option-key-to-varchar.md`
- **[Tests]** 1차원 optionKey 관련 단위/통합/E2E 테스트 추가

### ❌ Removed
- **[WMS]** `OptionEngineService` 모듈 전체 제거
  - `libs/shared/src/option-engine/` 삭제
- **[WMS]** `MasterService.generateSkusFromOptions()` 메서드 제거
- **[WMS]** `OptionMatchingStrategy` 전략 제거
  - `apps/wms/src/inventory/strategies/option-matching.strategy.ts` 삭제
- **[WMS]** `product_option_matchings` 테이블 제거
  - 데이터베이스 마이그레이션에 포함

### 🔧 Changed
- **[WMS]** `inventory_product_masters.optionSchema` 필드를 deprecated로 표시
  - UI 호환성을 위해 유지, 향후 제거 예정
  - WMS는 더 이상 이 필드를 사용하지 않음
- **[WMS]** SKU 생성 시 `optionKey`는 1차원 문자열로만 저장
  - 형식: "값1 / 값2 / 값3" (최대 255자)
  - 예시: "S / 검정", "256GB / 퍼플 / Wi-Fi"

### 📝 Migration Guide

#### 데이터베이스 마이그레이션

```bash
# 1. 백업 (선택사항, 개발 단계)
pg_dump almondyoung_wms > backup_$(date +%Y%m%d).sql

# 2. 마이그레이션 실행
npm run db:push.wms
psql -d almondyoung_wms -f apps/wms/database/migrations/manual_0001_option_key_migration.sql

# 3. 검증
npm run wms:test
```

#### API 클라이언트 코드 수정

**Before:**
```typescript
const response = await fetch('/api/wms/inventory/skus', {
  method: 'POST',
  body: JSON.stringify({
    name: "테스트 SKU",
    optionKey: { "사이즈": "M", "색상": "블랙" }  // ❌ 객체
  })
});
```

**After:**
```typescript
const response = await fetch('/api/wms/inventory/skus', {
  method: 'POST',
  body: JSON.stringify({
    name: "테스트 SKU",
    optionKey: "M / 블랙"  // ✅ 문자열
  })
});
```

#### generateSkusFromOptions 호출 제거

**Before:**
```typescript
// ❌ 제거된 엔드포인트
await fetch(`/api/wms/inventory/masters/${masterId}/generate-skus`, {
  method: 'POST'
});
```

**After:**
```typescript
// ✅ SKU는 수동으로 생성하거나 Product Matching 사용
await fetch('/api/wms/inventory/skus', {
  method: 'POST',
  body: JSON.stringify({
    name: "M / 블랙 티셔츠",
    masterId: masterId,
    optionKey: "M / 블랙"
  })
});
```

### 📚 관련 문서
- [PIM-WMS 옵션 아키텍처](./docs/pim-wms-option-architecture.md)
- [마이그레이션 가이드](./docs/migrations/0001-option-key-to-varchar.md)
- [구현 계획서](./docs/wms-option-migration-implementation-plan.md)

---

## [0.1.0] - 2025-01-08 (이전 버전)
...
```

##### 3.4.2 README.md 업데이트 (필요 시)

**파일**: `README.md`

```markdown
# Almondyoung Server

## Recent Updates

### 🔴 WMS 옵션 구조 개편 (2025-01-09)

WMS의 옵션 키가 조합형(JSONB)에서 1차원(VARCHAR) 구조로 변경되었습니다.

**주요 변경사항:**
- `skus.optionKey`: 이제 문자열만 허용 (예: "M / 블랙")
- `POST /masters/:id/generate-skus`: 엔드포인트 제거
- Product Matching: option 전략 제거 (void, variant만 지원)

자세한 내용은 [CHANGELOG.md](./CHANGELOG.md)를 참조하세요.

## Database Commands

```bash
# WMS Database
npm run db:push.wms        # Push schema changes
npm run db:generate.wms    # Generate migrations
npm run db:studio.wms      # Open Drizzle Studio
```

...
```

**체크포인트:**
- [ ] `CHANGELOG.md` 작성 완료
- [ ] `README.md` 업데이트 (필요 시)

---

#### Step 3.5: 최종 검증 (1시간)

##### 3.5.1 전체 빌드 및 테스트

```bash
# 1. 전체 프로젝트 빌드
npm run build

# 2. 린트 검사
npm run lint

# 3. TypeScript 타입 체크
npx tsc --noEmit

# 4. 전체 테스트 실행
npm run test

# 5. WMS 테스트
npm run wms:test

# 6. E2E 테스트
npm run test:e2e

# 7. 커버리지 확인
npm run test:cov
```

**통과 기준:**
- [ ] 빌드 에러 없음
- [ ] 린트 에러 없음
- [ ] TypeScript 컴파일 에러 없음
- [ ] 단위 테스트 100% 통과
- [ ] 통합 테스트 100% 통과
- [ ] E2E 테스트 100% 통과
- [ ] 커버리지 85% 이상

##### 3.5.2 데이터베이스 검증

```sql
-- 1. 스키마 검증
\d skus

-- 예상:
-- option_key | character varying(255)

-- 2. 제약 검증
SELECT
  conname,
  contype
FROM pg_constraint
WHERE conrelid = 'skus'::regclass;

-- 예상:
-- skus_master_id_option_key_unique | u (unique)

-- 3. 인덱스 검증
\di skus*

-- 예상:
-- skus_master_id_option_key_unique (unique)
-- idx_sku_code (btree)
-- idx_sku_master (btree)

-- 4. 테이블 제거 검증
\dt *option*

-- 예상:
-- (product_option_matchings 없어야 함)

-- 5. Enum 검증
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'matching_strategy'::regtype
ORDER BY enumlabel;

-- 예상:
-- variant
-- void
```

##### 3.5.3 API 최종 검증

**Postman/Insomnia Collection 실행:**

1. ✅ `POST /skus` - string optionKey
2. ✅ `POST /skus` - null optionKey
3. ❌ `POST /skus` - object optionKey (400 Bad Request)
4. ✅ `GET /skus/:id` - optionKey 조회
5. ✅ `PATCH /skus/:id` - optionKey 업데이트
6. ❌ `POST /masters/:id/generate-skus` (404 Not Found)

**Swagger 확인:**

- [ ] `CreateSkuDto.optionKey`: string 타입
- [ ] `SkuResponseDto.optionKey`: string | null
- [ ] `generateSkus` 엔드포인트 없음

**체크포인트:**
- [ ] 전체 빌드 및 테스트 통과
- [ ] 데이터베이스 검증 완료
- [ ] API 최종 검증 완료

---

#### Step 3.6: Git 커밋 및 배포 준비 (1.5시간)

##### 3.6.1 변경사항 리뷰

```bash
# 변경된 파일 확인
git status

# 예상 변경 파일:
# - apps/wms/database/schemas/wms-schema.ts
# - apps/wms/src/inventory/dto/sku/*.dto.ts
# - apps/wms/src/inventory/services/*.service.ts
# - apps/wms/src/inventory/controllers/master.controller.ts
# - apps/wms/src/inventory/inventory.module.ts
# - docs/pim-wms-option-architecture.md
# - docs/migrations/0001-option-key-to-varchar.md
# - CHANGELOG.md
# - 삭제: libs/shared/src/option-engine/
# - 삭제: apps/wms/src/inventory/strategies/option-matching.strategy.ts

# Diff 확인
git diff
```

##### 3.6.2 Git 커밋

```bash
# 1. 모든 변경사항 스테이징
git add .

# 2. Conventional Commit 형식으로 커밋
git commit -m "feat(wms)!: migrate option key from JSONB to VARCHAR

BREAKING CHANGES:
- Change skus.optionKey type from JSONB to VARCHAR(255)
- Remove POST /masters/:id/generate-skus endpoint
- Remove 'option' matching strategy (only void/variant supported)
- Remove OptionEngineService and related code
- Remove product_option_matchings table

Features:
- Add 1D option key support (string format)
- Simplify WMS option architecture
- Improve inventory continuity (SKUs never deleted)
- Preserve stock_events integrity

Migration:
- Run 'npm run db:push.wms' to apply schema changes
- Run manual migration SQL for enum and table cleanup
- Update API clients to use string optionKey

Docs:
- Update pim-wms-option-architecture.md
- Add migration guide (0001-option-key-to-varchar.md)
- Update CHANGELOG.md

Tests:
- Add unit tests for 1D optionKey
- Add integration tests for CRUD operations
- Add E2E tests for API endpoints
- All tests passing with 85%+ coverage

Closes #XXX"

# 3. 태그 생성
git tag -a v1.0.0-option-migration -m "WMS Option Key Migration to 1D Structure"
```

##### 3.6.3 PR 생성 준비

**PR 템플릿:**

```markdown
# WMS 옵션 구조 1차원 전환

## 개요
WMS의 옵션 키를 조합형(JSONB)에서 1차원(VARCHAR) 구조로 개편합니다.

## 동기
- **재고 연속성 보장**: SKU 삭제 방지, stock_events 이력 보존
- **도메인 분리**: WMS는 PIM의 조합 개념을 이해하지 않음
- **아키텍처 단순화**: 불필요한 OptionEngine 제거

## 변경 사항

### Database
- [x] `skus.option_key`: JSONB → VARCHAR(255)
- [x] `product_option_matchings`: 테이블 삭제
- [x] `matching_strategy`: 'option' enum 값 제거

### Application
- [x] DTO 타입 수정 (CreateSkuDto, SkuResponseDto, UpdateSkuDto)
- [x] `MasterService.generateSkusFromOptions()` 제거
- [x] `OptionEngineService` 모듈 제거
- [x] `OptionMatchingStrategy` 제거

### API
- [x] `POST /masters/:id/generate-skus` 엔드포인트 제거
- [x] SKU 생성/수정 시 optionKey string만 허용

### Documentation
- [x] pim-wms-option-architecture.md 갱신
- [x] 마이그레이션 가이드 작성
- [x] CHANGELOG 업데이트

### Tests
- [x] 단위 테스트 (14개)
- [x] 통합 테스트 (5개)
- [x] E2E 테스트 (7개)
- [x] 커버리지 87%

## 마이그레이션

```bash
npm run db:push.wms
psql -d almondyoung_wms -f apps/wms/database/migrations/manual_0001_option_key_migration.sql
npm run wms:test
```

## Breaking Changes ⚠️

### API 클라이언트 코드 수정 필요

**Before:**
```typescript
optionKey: { "사이즈": "M" }  // ❌
```

**After:**
```typescript
optionKey: "M / 블랙"  // ✅
```

### 제거된 엔드포인트

- `POST /api/wms/inventory/masters/:id/generate-skus`

## 테스트 결과

- ✅ 단위 테스트: 14/14 통과
- ✅ 통합 테스트: 5/5 통과
- ✅ E2E 테스트: 7/7 통과
- ✅ 커버리지: 87%
- ✅ 린트: 에러 없음
- ✅ TypeScript: 컴파일 에러 없음

## 체크리스트

- [x] 코드 리뷰 완료
- [x] 테스트 통과
- [x] 문서 업데이트
- [x] 마이그레이션 스크립트 검증
- [x] Breaking Changes 문서화

## 관련 이슈

Closes #XXX

## 스크린샷

(Swagger UI 스크린샷 첨부)
```

##### 3.6.4 배포 준비

```bash
# 1. 원격 브랜치에 푸시
git push origin feat/wms-1d-option-key
git push --tags

# 2. PR 생성 (GitHub/GitLab)
# - 위 PR 템플릿 사용
# - 라벨: breaking-change, enhancement, wms

# 3. 배포 스크립트 준비 (필요 시)
cat > scripts/deploy-option-migration.sh <<'EOF'
#!/bin/bash
set -e

echo "🚀 Starting WMS Option Migration Deployment..."

# 1. Pull latest code
git pull origin feat/wms-1d-option-key

# 2. Install dependencies
npm ci

# 3. Build
npm run build:wms

# 4. Run migrations
npm run db:push.wms
psql -h $DB_HOST -U $DB_USER -d almondyoung_wms \
  -f apps/wms/database/migrations/manual_0001_option_key_migration.sql

# 5. Run tests
npm run wms:test

# 6. Restart service
pm2 restart wms

echo "✅ Deployment completed successfully!"
EOF

chmod +x scripts/deploy-option-migration.sh
```

**체크포인트:**
- [ ] Git 커밋 완료
- [ ] 태그 생성
- [ ] 원격 푸시
- [ ] PR 생성 준비
- [ ] 배포 스크립트 작성 (필요 시)

---

## 검증 체크리스트

### Day 1 ✅
- [ ] Git 브랜치 생성
- [ ] OptionEngineService 삭제
- [ ] OptionMatchingStrategy 삭제
- [ ] MasterService 정리
- [ ] MasterController 정리
- [ ] 스키마 수정 (optionKey VARCHAR)
- [ ] productOptionMatchings 제거
- [ ] matchingStrategyEnum 수정
- [ ] DTO 타입 수정 (4개 파일)
- [ ] 서비스 로직 수정
- [ ] 컴파일 성공

### Day 2 ✅
- [ ] 마이그레이션 SQL 작성
- [ ] 로컬 DB 마이그레이션 실행
- [ ] 단위 테스트 작성 (14개)
- [ ] 통합 테스트 작성 (5개)
- [ ] E2E 테스트 작성 (7개)
- [ ] 전체 테스트 통과
- [ ] 커버리지 85% 이상

### Day 3 ✅
- [ ] Swagger UI 확인
- [ ] cURL 테스트 (5개)
- [ ] Postman Collection 생성
- [ ] 인덱스 성능 확인
- [ ] Bulk Insert 성능 테스트
- [ ] pim-wms-option-architecture.md 갱신
- [ ] 마이그레이션 문서 작성
- [ ] CHANGELOG.md 작성
- [ ] README.md 업데이트
- [ ] 전체 빌드 성공
- [ ] 최종 DB 검증
- [ ] 최종 API 검증
- [ ] Git 커밋 및 태그
- [ ] PR 생성 준비

---

## 긴급 롤백 가이드

### ⚡ 개발 단계: Git Reset 권장

```bash
# 1. 변경사항 폐기
git reset --hard <이전-커밋-해시>

# 2. 의존성 재설치
npm ci

# 3. 빌드
npm run build:wms

# 4. DB 리셋 (개발 환경)
npm run db:push.wms

# 5. 서버 재시작
npm run start:wms:dev
```

### 데이터베이스만 롤백 (비권장)

```sql
-- 긴급 상황에서만 사용
BEGIN;

-- optionKey를 JSONB로 복구
ALTER TABLE skus DROP COLUMN option_key;
ALTER TABLE skus ADD COLUMN option_key JSONB;

-- 기타 복구 작업...

COMMIT;
```

---

## FAQ

**Q: 기존 데이터는 어떻게 되나요?**
A: 개발 단계이므로 데이터 폐기 방식을 사용합니다. 프로덕션 데이터가 있다면 마이그레이션 SQL을 데이터 보존 버전으로 교체해야 합니다.

**Q: API 클라이언트 코드는 언제 수정하나요?**
A: 마이그레이션 완료 후 즉시 수정 필요합니다. optionKey를 문자열로 변경하세요.

**Q: optionSchema는 왜 제거하지 않나요?**
A: UI 호환성을 위해 유지합니다. 향후 PIM과 완전 분리 시 제거 예정입니다.

**Q: Option 전략 사용 중인 매칭은?**
A: 마이그레이션 SQL에서 자동으로 삭제됩니다 (개발 단계). 프로덕션이라면 Variant 전략으로 수동 전환 필요합니다.

---

## 참고 자료

- [PIM-WMS 옵션 아키텍처](./pim-wms-option-architecture.md)
- [Drizzle ORM - Column Types](https://orm.drizzle.team/docs/column-types/pg)
- [PostgreSQL ALTER TYPE](https://www.postgresql.org/docs/current/sql-altertype.html)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

**문서 버전**: 1.0
**작성일**: 2025-01-09
**작성자**: Development Team
**예상 완료일**: 2025-01-12 (3일)
