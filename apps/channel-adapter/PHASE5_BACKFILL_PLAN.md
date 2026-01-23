# Phase 5: 백필 스크립트 개선 계획

**작성일**: 2026-01-23
**목적**: PIM → Medusa 전체 마이그레이션 스크립트 개선

---

## 1. 현재 상황 분석

### 1.1 기존 스크립트 문제점

```typescript
// apps/channel-adapter/scripts/migrate-pim-to-medusa.ts (현재)

// ❌ 문제 1: PimClient 의존 (Phase 2에서 제거됨)
const pimClient = new PimClient(configService);
await pimClient.getActiveVersion(masterId); // MSA 경계 위반

// ❌ 문제 2: N+1 문제 (masterId만 조회 후 API 호출)
const masters = await getMastersFromDb(PIM_SOURCE_DB_URL); // 100개
for (const masterId of masters) {
  const snapshot = await pimClient.getActiveVersion(masterId); // 100번 HTTP 호출!
}

// ❌ 문제 3: 기본적인 에러 핸들링만
try {
  await syncService.syncMaster(masterId);
} catch (err) {
  console.error(`❌ ${masterId}:`, err?.message); // 로그만 찍고 계속
}

// ❌ 문제 4: 진행 상황 미저장
// 중간에 실패하면 처음부터 재시작

// ❌ 문제 5: 실패 항목 추적 없음
// 어떤 상품이 왜 실패했는지 DB에 기록 안 함
```

### 1.2 개선 목표

1. **PIM DB 직접 연결** - JOIN 쿼리로 전체 스냅샷 1회 조회
2. **배치 처리 개선** - 체크포인트 기반 증분 처리
3. **에러 핸들링 강화** - 실패 목록 저장, 자동 재시도
4. **진행 상황 추적** - DB 상태 저장 (중단 후 재개 가능)

---

## 2. PIM DB JOIN 쿼리 설계

### 2.1 필요한 데이터 (ProductSnapshot)

문서(`CHANNEL_ADAPTER_REDESIGN.md` 3.2절)의 `ProductSnapshot` 인터페이스:

```typescript
interface ProductSnapshot {
  // 기본 정보
  masterId: string;
  versionId: string;
  version: number;
  name: string;
  description?: string;
  descriptionHtml?: string;

  // 이미지
  thumbnail?: string;
  images?: Array<{
    fileId: string;
    url: string;
    isPrimary: boolean;
    sortOrder: number;
  }>;

  // SEO
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;

  // 카테고리 정보 (전체 경로 포함)
  categories?: Array<{
    id: string;
    name: string;
    slug: string;
    path: string;
    parentId: string | null;
    isActive: boolean;
    visibility: boolean;
    showOnMainCategory: boolean;
    thumbnail?: string;
  }>;

  // 메타데이터
  brand?: string;
  tags?: string[];
  productType?: string;

  // 옵션
  optionGroups?: Array<{
    id: string;
    name: string;
    values: Array<{
      id: string;
      name: string;
      colorCode?: string;
      imageUrl?: string;
    }>;
  }>;

  // 변형
  variants: Array<{
    id: string;
    variantName: string;
    sku: string;
    variantCode?: string;
    isDefault: boolean;
    status: string;
    optionCombination?: Array<{
      name: string;
      value: string;
    }>;
    basePrice: number;
    membershipPrice?: number;
    tieredPrices?: Array<{
      minQuantity: number;
      price: number;
    }>;
  }>;

  // 상태
  status: 'active' | 'draft' | 'archived';
  isWholesaleOnly: boolean;
  isMembershipOnly: boolean;
  isGiftcard: boolean;
  discountable: boolean;
}
```

### 2.2 PIM DB 스키마 매핑

**관련 테이블**:
- `product_masters` (마스터)
- `product_master_versions` (버전별 데이터)
- `product_master_categories` (카테고리 매핑)
- `product_categories` (카테고리 정보)
- `product_master_variants` (변형 매핑)
- `product_variants` (변형 정보)
- `product_master_option_groups` (옵션 그룹 매핑)
- `product_option_groups` (옵션 그룹)
- `product_option_values` (옵션 값)
- (이미지는 별도 처리 필요 - 추후 확인)

### 2.3 최적화된 조회 쿼리

#### 2.3.1 Active Masters 조회 (1단계)

```sql
-- 활성화된 모든 마스터와 버전 정보 조회
SELECT
  pm.id AS master_id,
  pmv.id AS version_id,
  pmv.version,
  pmv.name,
  pmv.description,
  pmv.description_html,
  pmv.brand,
  pmv.thumbnail,
  pmv.seo_title,
  pmv.seo_description,
  pmv.seo_keywords,
  pmv.product_type,
  pmv.status,
  pmv.is_wholesale_only,
  pmv.is_membership_only,
  pmv.created_at,
  pmv.updated_at
FROM product_masters pm
INNER JOIN product_master_versions pmv
  ON pm.id = pmv.master_id
WHERE pmv.status = 'active'
  AND pmv.deleted_at IS NULL
  AND pm.deleted_at IS NULL
ORDER BY pm.created_at DESC
LIMIT 100 OFFSET 0; -- 배치 처리용
```

#### 2.3.2 카테고리 정보 조회 (2단계)

```sql
-- 특정 마스터들의 카테고리 정보 조회 (batch)
SELECT
  pmc.master_id,
  pmc.version_id,
  pc.id AS category_id,
  pc.name AS category_name,
  pc.slug,
  pc.path,
  pc.parent_id,
  pc.is_active,
  pc.visibility,
  pc.display_settings,
  pc.image_url AS thumbnail
FROM product_master_categories pmc
INNER JOIN product_categories pc
  ON pmc.category_id = pc.id
WHERE pmc.master_id = ANY($1::uuid[]) -- batch IDs
  AND pmc.version_id = ANY($2::uuid[]); -- batch version IDs
```

#### 2.3.3 Variants 정보 조회 (3단계)

```sql
-- 특정 마스터들의 variant 정보 조회 (batch)
SELECT
  pmv.master_id,
  pmv.version_id,
  pv.id AS variant_id,
  pv.variant_name,
  pv.sku,
  pv.variant_code,
  pv.is_default,
  pv.status,
  pv.base_price,
  pv.membership_price,
  pv.tiered_prices,
  pv.option_combination
FROM product_master_variants pmv
INNER JOIN product_variants pv
  ON pmv.variant_id = pv.id
WHERE pmv.master_id = ANY($1::uuid[])
  AND pmv.version_id = ANY($2::uuid[])
ORDER BY pmv.master_id, pv.is_default DESC;
```

#### 2.3.4 Option Groups 조회 (4단계)

```sql
-- 특정 마스터들의 옵션 그룹 조회 (batch)
SELECT
  pmog.master_id,
  pmog.version_id,
  pog.id AS option_group_id,
  pog.name AS option_group_name,
  pov.id AS option_value_id,
  pov.name AS option_value_name,
  pov.color_code,
  pov.image_url
FROM product_master_option_groups pmog
INNER JOIN product_option_groups pog
  ON pmog.option_group_id = pog.id
LEFT JOIN product_option_values pov
  ON pov.option_group_id = pog.id
WHERE pmog.master_id = ANY($1::uuid[])
  AND pmog.version_id = ANY($2::uuid[])
ORDER BY pmog.master_id, pog.id, pov.id;
```

### 2.4 데이터 조립 로직

```typescript
// apps/channel-adapter/scripts/backfill-v2.ts

interface PimMasterRow {
  master_id: string;
  version_id: string;
  version: number;
  name: string;
  description?: string;
  description_html?: string;
  brand?: string;
  thumbnail?: string;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string[];
  product_type?: string;
  status: string;
  is_wholesale_only: boolean;
  is_membership_only: boolean;
}

async function fetchMastersWithFullSnapshot(
  pimDb: postgres.Sql,
  limit: number,
  offset: number
): Promise<PimProductSnapshot[]> {
  // 1. Active Masters 조회
  const masters = await pimDb<PimMasterRow[]>`
    SELECT
      pm.id AS master_id,
      pmv.id AS version_id,
      pmv.version,
      pmv.name,
      pmv.description,
      pmv.description_html,
      pmv.brand,
      pmv.thumbnail,
      pmv.seo_title,
      pmv.seo_description,
      pmv.seo_keywords,
      pmv.product_type,
      pmv.status,
      pmv.is_wholesale_only,
      pmv.is_membership_only
    FROM product_masters pm
    INNER JOIN product_master_versions pmv ON pm.id = pmv.master_id
    WHERE pmv.status = 'active'
      AND pmv.deleted_at IS NULL
      AND pm.deleted_at IS NULL
    ORDER BY pm.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  if (masters.length === 0) return [];

  const masterIds = masters.map(m => m.master_id);
  const versionIds = masters.map(m => m.version_id);

  // 2. Batch로 카테고리 조회
  const categories = await pimDb`
    SELECT
      pmc.master_id,
      pmc.version_id,
      pc.id AS category_id,
      pc.name AS category_name,
      pc.slug,
      pc.path,
      pc.parent_id,
      pc.is_active,
      pc.visibility,
      pc.display_settings,
      pc.image_url AS thumbnail
    FROM product_master_categories pmc
    INNER JOIN product_categories pc ON pmc.category_id = pc.id
    WHERE pmc.master_id = ANY(${masterIds})
      AND pmc.version_id = ANY(${versionIds})
  `;

  // 3. Batch로 Variants 조회
  const variants = await pimDb`
    SELECT
      pmv.master_id,
      pmv.version_id,
      pv.id AS variant_id,
      pv.variant_name,
      pv.sku,
      pv.variant_code,
      pv.is_default,
      pv.status,
      pv.base_price,
      pv.membership_price,
      pv.tiered_prices,
      pv.option_combination
    FROM product_master_variants pmv
    INNER JOIN product_variants pv ON pmv.variant_id = pv.id
    WHERE pmv.master_id = ANY(${masterIds})
      AND pmv.version_id = ANY(${versionIds})
    ORDER BY pmv.master_id, pv.is_default DESC
  `;

  // 4. Batch로 Option Groups 조회
  const optionGroups = await pimDb`
    SELECT
      pmog.master_id,
      pmog.version_id,
      pog.id AS option_group_id,
      pog.name AS option_group_name,
      pov.id AS option_value_id,
      pov.name AS option_value_name,
      pov.color_code,
      pov.image_url
    FROM product_master_option_groups pmog
    INNER JOIN product_option_groups pog ON pmog.option_group_id = pog.id
    LEFT JOIN product_option_values pov ON pov.option_group_id = pog.id
    WHERE pmog.master_id = ANY(${masterIds})
      AND pmog.version_id = ANY(${versionIds})
    ORDER BY pmog.master_id, pog.id, pov.id
  `;

  // 5. 데이터 조립 (masterId 기준으로 그룹화)
  const snapshots: PimProductSnapshot[] = masters.map(master => {
    // 카테고리 매핑
    const masterCategories = categories
      .filter(c => c.master_id === master.master_id)
      .map(c => ({
        id: c.category_id,
        name: c.category_name,
        slug: c.slug,
        path: c.path,
        parentId: c.parent_id,
        isActive: c.is_active,
        visibility: c.visibility,
        showOnMainCategory: c.display_settings?.showOnMainCategory ?? false,
        thumbnail: c.thumbnail,
      }));

    // Variants 매핑
    const masterVariants = variants
      .filter(v => v.master_id === master.master_id)
      .map(v => ({
        id: v.variant_id,
        variantName: v.variant_name,
        sku: v.sku,
        variantCode: v.variant_code,
        isDefault: v.is_default,
        status: v.status,
        optionCombination: v.option_combination || [],
        basePrice: Number(v.base_price),
        membershipPrice: v.membership_price ? Number(v.membership_price) : undefined,
        tieredPrices: v.tiered_prices || [],
      }));

    // Option Groups 매핑
    const masterOptions = optionGroups
      .filter(o => o.master_id === master.master_id);

    const groupedOptions = new Map<string, any>();
    masterOptions.forEach(opt => {
      if (!groupedOptions.has(opt.option_group_id)) {
        groupedOptions.set(opt.option_group_id, {
          id: opt.option_group_id,
          name: opt.option_group_name,
          values: []
        });
      }

      if (opt.option_value_id) {
        groupedOptions.get(opt.option_group_id).values.push({
          id: opt.option_value_id,
          name: opt.option_value_name,
          colorCode: opt.color_code,
          imageUrl: opt.image_url,
        });
      }
    });

    return {
      masterId: master.master_id,
      versionId: master.version_id,
      version: master.version,
      name: master.name,
      description: master.description,
      descriptionHtml: master.description_html,
      thumbnail: master.thumbnail,
      seoTitle: master.seo_title,
      seoDescription: master.seo_description,
      seoKeywords: master.seo_keywords?.join(','),
      brand: master.brand,
      productType: master.product_type,
      categories: masterCategories,
      variants: masterVariants,
      optionGroups: Array.from(groupedOptions.values()),
      status: master.status as any,
      isWholesaleOnly: master.is_wholesale_only,
      isMembershipOnly: master.is_membership_only,
      isGiftcard: false, // PIM 스키마에 없으면 기본값
      discountable: true, // PIM 스키마에 없으면 기본값
    };
  });

  return snapshots;
}
```

---

## 3. 배치 처리 및 체크포인트

### 3.1 진행 상황 추적 테이블

Channel Adapter DB에 마이그레이션 상태 테이블 추가:

```typescript
// apps/channel-adapter/src/schema.ts

export const migrationProgress = pgTable(
  'migration_progress',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),

    // 마이그레이션 세션 정보
    sessionId: varchar('session_id', { length: 100 }).notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    status: varchar('status', { length: 20 }).notNull().default('in_progress'),
    // 'in_progress' | 'completed' | 'failed' | 'paused'

    // 진행 상황
    totalMasters: integer('total_masters').notNull().default(0),
    processedCount: integer('processed_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),

    // 배치 정보
    batchSize: integer('batch_size').notNull().default(100),
    currentOffset: integer('current_offset').notNull().default(0),
    lastProcessedMasterId: varchar('last_processed_master_id', { length: 100 }),

    // 에러 정보
    lastError: text('last_error'),
    errorStackTrace: text('error_stack_trace'),

    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_migration_session').on(table.sessionId),
    index('idx_migration_status').on(table.status),
  ]
);

export const migrationFailures = pgTable(
  'migration_failures',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),

    sessionId: varchar('session_id', { length: 100 }).notNull(),
    masterId: varchar('master_id', { length: 100 }).notNull(),
    versionId: varchar('version_id', { length: 100 }),

    errorType: varchar('error_type', { length: 50 }).notNull(),
    // 'validation_error' | 'medusa_api_error' | 'db_error' | 'unknown'

    errorMessage: text('error_message').notNull(),
    stackTrace: text('stack_trace'),

    retryCount: integer('retry_count').notNull().default(0),
    lastRetryAt: timestamp('last_retry_at'),
    resolved: boolean('resolved').notNull().default(false),

    snapshot: jsonb('snapshot'), // 실패 시점의 스냅샷 저장 (재시도용)

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_migration_failures_session').on(table.sessionId),
    index('idx_migration_failures_master').on(table.masterId),
    index('idx_migration_failures_resolved').on(table.resolved),
  ]
);
```

### 3.2 배치 처리 로직

```typescript
// apps/channel-adapter/scripts/backfill-v2.ts

interface BackfillOptions {
  batchSize?: number;
  resumeSessionId?: string; // 중단된 세션 재개
  retryFailed?: boolean; // 실패 항목만 재시도
  limit?: number; // 전체 처리 개수 제한 (테스트용)
}

async function runBackfill(options: BackfillOptions = {}) {
  const {
    batchSize = 100,
    resumeSessionId,
    retryFailed = false,
    limit,
  } = options;

  // 1. 세션 초기화 또는 재개
  let session: MigrationSession;
  if (resumeSessionId) {
    session = await loadSession(resumeSessionId);
    console.log(`📦 Resuming session: ${resumeSessionId} (offset: ${session.currentOffset})`);
  } else if (retryFailed) {
    session = await createRetrySession();
    console.log(`🔁 Retry session created for failed items`);
  } else {
    session = await createNewSession(batchSize);
    console.log(`🆕 New session created: ${session.sessionId}`);
  }

  const pimDb = postgres(process.env.PIM_SOURCE_DB_URL!);
  const channelAdapterDb = new DbService(...);

  try {
    let offset = session.currentOffset;
    let totalProcessed = 0;

    while (true) {
      // 2. 배치 조회
      const snapshots = await fetchMastersWithFullSnapshot(
        pimDb,
        batchSize,
        offset
      );

      if (snapshots.length === 0) {
        console.log('✅ No more masters to process');
        break;
      }

      console.log(`\n📊 Batch ${offset / batchSize + 1}: Processing ${snapshots.length} masters...`);

      // 3. 배치 처리
      const batchResults = await processBatch(
        snapshots,
        session.sessionId,
        channelAdapterDb
      );

      // 4. 진행 상황 업데이트
      await updateSessionProgress(channelAdapterDb, session.sessionId, {
        processedCount: session.processedCount + snapshots.length,
        successCount: session.successCount + batchResults.successCount,
        failedCount: session.failedCount + batchResults.failedCount,
        skippedCount: session.skippedCount + batchResults.skippedCount,
        currentOffset: offset + batchSize,
        lastProcessedMasterId: snapshots[snapshots.length - 1].masterId,
      });

      totalProcessed += snapshots.length;

      // 5. 제한 체크 (테스트용)
      if (limit && totalProcessed >= limit) {
        console.log(`⏸️  Limit reached: ${limit}`);
        break;
      }

      offset += batchSize;

      // Rate limiting (Medusa API 부하 방지)
      await sleep(1000);
    }

    // 6. 세션 완료
    await completeSession(channelAdapterDb, session.sessionId);
    console.log(`\n🎉 Migration completed!`);
    printSummary(session);

  } catch (error) {
    console.error(`❌ Migration failed:`, error);
    await failSession(channelAdapterDb, session.sessionId, error);
    throw error;
  } finally {
    await pimDb.end();
  }
}
```

### 3.3 배치 처리 함수

```typescript
interface BatchResult {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: Array<{
    masterId: string;
    error: Error;
  }>;
}

async function processBatch(
  snapshots: PimProductSnapshot[],
  sessionId: string,
  db: DbService
): Promise<BatchResult> {
  const results: BatchResult = {
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    failures: [],
  };

  for (const snapshot of snapshots) {
    try {
      // 검증
      validatePimSnapshot(snapshot);

      // 동기화 (Phase 2에서 구현된 syncFromSnapshot 사용)
      const syncResult = await syncService.syncFromSnapshot(snapshot);

      if (syncResult.success) {
        results.successCount++;
        console.log(`  ✅ ${snapshot.masterId}: ${syncResult.action}`);
      } else {
        results.skippedCount++;
        console.log(`  ⏭️  ${snapshot.masterId}: skipped`);
      }

    } catch (error: any) {
      results.failedCount++;
      results.failures.push({
        masterId: snapshot.masterId,
        error,
      });

      // 실패 기록 저장
      await recordFailure(db, {
        sessionId,
        masterId: snapshot.masterId,
        versionId: snapshot.versionId,
        errorType: classifyError(error),
        errorMessage: error.message,
        stackTrace: error.stack,
        snapshot, // 재시도를 위해 스냅샷 저장
      });

      console.error(`  ❌ ${snapshot.masterId}: ${error.message}`);
    }
  }

  return results;
}
```

---

## 4. 에러 핸들링 및 재시도

### 4.1 에러 분류

```typescript
type ErrorType =
  | 'validation_error'    // 스냅샷 검증 실패
  | 'medusa_api_error'    // Medusa API 호출 실패
  | 'db_error'            // DB 작업 실패
  | 'network_error'       // 네트워크 타임아웃
  | 'unknown';            // 기타

function classifyError(error: any): ErrorType {
  if (error.name === 'ValidationError') {
    return 'validation_error';
  }

  if (error.response?.status) {
    return 'medusa_api_error';
  }

  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
    return 'network_error';
  }

  if (error.message?.includes('database')) {
    return 'db_error';
  }

  return 'unknown';
}
```

### 4.2 자동 재시도 로직

```typescript
async function syncWithRetry(
  snapshot: PimProductSnapshot,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<SyncResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  🔄 Attempt ${attempt}/${maxRetries}: ${snapshot.masterId}`);

      const result = await syncService.syncFromSnapshot(snapshot);

      if (result.success) {
        if (attempt > 1) {
          console.log(`  ✅ Succeeded on retry ${attempt}`);
        }
        return result;
      }

    } catch (error: any) {
      lastError = error;

      const errorType = classifyError(error);

      // 재시도 불가능한 에러는 즉시 실패
      if (errorType === 'validation_error') {
        console.error(`  ❌ Validation error, skipping retries`);
        throw error;
      }

      // 재시도 가능한 에러는 대기 후 재시도
      if (attempt < maxRetries) {
        const delay = retryDelay * attempt; // Exponential backoff
        console.warn(`  ⚠️  Attempt ${attempt} failed: ${error.message}, retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // 모든 재시도 실패
  throw new Error(
    `Failed after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}
```

### 4.3 실패 항목 재처리

```typescript
// 실패 항목만 재시도하는 스크립트
async function retryFailedMasters(sessionId: string) {
  const db = new DbService(...);

  // 1. 실패 항목 조회
  const failures = await db.select({
    masterId: migrationFailures.masterId,
    snapshot: migrationFailures.snapshot,
    retryCount: migrationFailures.retryCount,
  })
  .from(migrationFailures)
  .where(
    and(
      eq(migrationFailures.sessionId, sessionId),
      eq(migrationFailures.resolved, false)
    )
  );

  console.log(`🔁 Retrying ${failures.length} failed masters...`);

  let successCount = 0;
  let stillFailedCount = 0;

  for (const failure of failures) {
    try {
      const snapshot = failure.snapshot as PimProductSnapshot;

      // 재시도
      await syncWithRetry(snapshot, 3, 2000);

      // 성공 시 resolved = true
      await db.update(migrationFailures)
        .set({
          resolved: true,
          lastRetryAt: new Date(),
          retryCount: failure.retryCount + 1,
        })
        .where(eq(migrationFailures.masterId, failure.masterId));

      successCount++;
      console.log(`  ✅ ${failure.masterId}: Resolved`);

    } catch (error: any) {
      stillFailedCount++;

      // 재시도 횟수 증가
      await db.update(migrationFailures)
        .set({
          lastRetryAt: new Date(),
          retryCount: failure.retryCount + 1,
          errorMessage: error.message,
        })
        .where(eq(migrationFailures.masterId, failure.masterId));

      console.error(`  ❌ ${failure.masterId}: Still failing - ${error.message}`);
    }
  }

  console.log(`\n📊 Retry Results:`);
  console.log(`  ✅ Resolved: ${successCount}`);
  console.log(`  ❌ Still failing: ${stillFailedCount}`);
}
```

---

## 5. 스크립트 사용 방법

### 5.1 신규 전체 마이그레이션

```bash
# 전체 마이그레이션 (배치 크기 100)
PIM_SOURCE_DB_URL=postgres://... \
MEDUSA_API_URL=... \
MEDUSA_API_KEY=... \
DATABASE_URL=... \
npx ts-node apps/channel-adapter/scripts/backfill-v2.ts

# 배치 크기 지정
npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --batch-size=50

# 테스트 (처음 500개만)
npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --limit=500
```

### 5.2 중단된 마이그레이션 재개

```bash
# 세션 ID로 재개
npx ts-node apps/channel-adapter/scripts/backfill-v2.ts \
  --resume=550e8400-e29b-41d4-a716-446655440000
```

### 5.3 실패 항목만 재시도

```bash
# 특정 세션의 실패 항목 재시도
npx ts-node apps/channel-adapter/scripts/retry-failed.ts \
  --session=550e8400-e29b-41d4-a716-446655440000

# 모든 미해결 실패 항목 재시도
npx ts-node apps/channel-adapter/scripts/retry-failed.ts --all
```

### 5.4 진행 상황 모니터링

```bash
# 세션 상태 조회
npx ts-node apps/channel-adapter/scripts/check-progress.ts \
  --session=550e8400-e29b-41d4-a716-446655440000

# 실패 항목 목록 조회
npx ts-node apps/channel-adapter/scripts/list-failures.ts \
  --session=550e8400-e29b-41d4-a716-446655440000
```

---

## 6. 검증 계획

### 6.1 데이터 정합성 검증

```typescript
// apps/channel-adapter/scripts/verify-migration.ts

async function verifyMigration(sessionId: string) {
  const db = new DbService(...);

  // 1. 매핑 테이블 조회
  const mappings = await db.select()
    .from(pimMedusaMappings)
    .where(eq(pimMedusaMappings.syncStatus, 'synced'));

  console.log(`📊 Total synced products: ${mappings.length}`);

  // 2. Medusa에 실제 존재하는지 확인
  const medusaClient = new MedusaClient(configService);
  let existCount = 0;
  let missingCount = 0;

  for (const mapping of mappings) {
    const product = await medusaClient.findProductByHandle(mapping.medusaHandle);
    if (product) {
      existCount++;
    } else {
      missingCount++;
      console.warn(`⚠️  Missing in Medusa: ${mapping.pimMasterId} → ${mapping.medusaHandle}`);
    }
  }

  console.log(`\n✅ Exist in Medusa: ${existCount}`);
  console.log(`❌ Missing in Medusa: ${missingCount}`);

  // 3. PIM과 비교
  const pimDb = postgres(process.env.PIM_SOURCE_DB_URL!);
  const pimActiveCount = await pimDb`
    SELECT COUNT(*) AS count
    FROM product_masters pm
    INNER JOIN product_master_versions pmv ON pm.id = pmv.master_id
    WHERE pmv.status = 'active'
      AND pmv.deleted_at IS NULL
      AND pm.deleted_at IS NULL
  `;

  console.log(`\n📦 PIM active masters: ${pimActiveCount[0].count}`);
  console.log(`🎯 Synced to Medusa: ${mappings.length}`);
  console.log(`📉 Difference: ${Number(pimActiveCount[0].count) - mappings.length}`);
}
```

### 6.2 성능 측정

```typescript
// 배치 처리 성능 측정
interface PerformanceMetrics {
  batchNumber: number;
  batchSize: number;
  processTimeMs: number;
  avgTimePerProduct: number;
  successRate: number;
}

async function measureBatchPerformance(): Promise<PerformanceMetrics[]> {
  const metrics: PerformanceMetrics[] = [];

  // 배치별 처리 시간 기록
  // ...

  return metrics;
}
```

---

## 7. 마이그레이션 실행 체크리스트

### Phase 5 구현 체크리스트

- [ ] **DB 스키마 추가**
  - [ ] `migration_progress` 테이블 생성
  - [ ] `migration_failures` 테이블 생성
  - [ ] Drizzle migration 생성 및 실행

- [ ] **PIM DB 조회 로직**
  - [ ] `fetchMastersWithFullSnapshot()` 구현
  - [ ] 카테고리 배치 조회 쿼리 최적화
  - [ ] Variants 배치 조회 쿼리 최적화
  - [ ] Option Groups 배치 조회 쿼리 최적화
  - [ ] 데이터 조립 로직 구현

- [ ] **배치 처리 로직**
  - [ ] 세션 관리 (생성/재개/완료)
  - [ ] 배치 단위 처리
  - [ ] 진행 상황 DB 저장
  - [ ] 체크포인트 기능

- [ ] **에러 핸들링**
  - [ ] 에러 분류 로직
  - [ ] 자동 재시도 (exponential backoff)
  - [ ] 실패 기록 저장
  - [ ] 실패 항목 재처리 스크립트

- [ ] **유틸리티 스크립트**
  - [ ] `backfill-v2.ts` (메인 스크립트)
  - [ ] `retry-failed.ts` (재시도)
  - [ ] `check-progress.ts` (진행 상황 조회)
  - [ ] `verify-migration.ts` (검증)

- [ ] **테스트**
  - [ ] 소규모 테스트 (limit=10)
  - [ ] 중간 규모 테스트 (limit=100)
  - [ ] 실패 케이스 테스트
  - [ ] 재개 기능 테스트
  - [ ] 재시도 기능 테스트

- [ ] **검증**
  - [ ] 데이터 정합성 검증
  - [ ] 성능 측정
  - [ ] 실패율 분석

---

## 8. 예상 소요 시간

- **DB 스키마 및 마이그레이션**: 1-2시간
- **PIM DB 조회 로직**: 3-4시간
- **배치 처리 로직**: 3-4시간
- **에러 핸들링 및 재시도**: 2-3시간
- **유틸리티 스크립트**: 2-3시간
- **테스트 및 검증**: 3-4시간

**총 예상 시간**: 14-20시간 (2-3일)

---

## 9. 리스크 및 대응

### 리스크 1: PIM DB 스키마 변경
- **문제**: 문서화되지 않은 필드나 관계
- **대응**: 실제 스키마 확인 후 쿼리 조정

### 리스크 2: 대용량 데이터 처리
- **문제**: 수천~수만 개 상품 처리 시 메모리/시간
- **대응**: 배치 크기 조정 (50-100개), Rate limiting

### 리스크 3: Medusa API Rate Limit
- **문제**: 대량 요청 시 429 에러
- **대응**: 배치 간 대기 시간 추가, 재시도 로직

### 리스크 4: 중간 실패 시 복구
- **문제**: 네트워크 단절, 프로세스 종료
- **대응**: 체크포인트 기능으로 재개 가능

---

**다음 단계**: 실제 PIM 스키마를 확인하고 위 계획을 코드로 구현
