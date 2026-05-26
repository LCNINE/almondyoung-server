/**
 * Core(구 PIM) → Medusa 백필 스크립트 (in-process / Medusa exec)
 *
 * 사전 조건:
 *   1) `apps/medusa/scripts/extract-core-snapshots.ts` 가 이미 실행되어
 *      `apps/medusa/src/data/core-snapshots.json.gz` 가 image 에 baking 되어 있어야 함.
 *   2) Medusa task 가 실행 중 (scaling 적용 후 권장).
 *
 * 실행:
 *   yarn medusa exec ./src/scripts/backfill-from-core.ts
 *
 * 옵션 (process.env 로 전달):
 *   BACKFILL_LIMIT       — 표본 실행용 상한 (기본: 무제한)
 *   BACKFILL_BATCH_SIZE  — chunk 크기 (기본: 50)
 *   BACKFILL_RESUME      — 'true' 면 /tmp/backfill-progress.json 이어서 실행
 *
 * 동작:
 *   1) JSON.gz 로드 → snapshots[]
 *   2) Default Sales Channel 확보 (seed.ts 가 만든 것)
 *   3) 카테고리 prime: 모든 product_category list → metadata.pimCategoryId 매핑 캐시
 *      누락 카테고리는 부모→자식 순으로 create
 *   4) snapshots 를 batch 단위로 createProductsWorkflow 호출 (in-process, HTTP 우회)
 *   5) 처리한 master id 를 /tmp/backfill-progress.json 에 누적 → 중단 시 재개 가능
 *   6) 실패 건은 /tmp/backfill-failures.json 에 dump
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createProductsWorkflow } from '@medusajs/medusa/core-flows';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  transformPimToMedusa,
  validatePimSnapshot,
  PimSnapshotValidationError,
  type PimProductSnapshot,
} from './lib/transformer';
import { toWorkflowInput } from './lib/payload-to-workflow-input';
import { ensureSellableInventoryProjectionLinks } from './lib/sellable-inventory-projection';

interface Bundle {
  meta: {
    extractedAt: string;
    totalCount: number;
    sourceHost: string;
    schemaVersion: number;
  };
  snapshots: PimProductSnapshot[];
}

const PROGRESS_PATH = '/tmp/backfill-progress.json';
const FAILURES_PATH = '/tmp/backfill-failures.json';
const DATA_PATH_CANDIDATES = [
  path.resolve(__dirname, '../data/core-snapshots.json.gz'),
  path.resolve(process.cwd(), 'src/data/core-snapshots.json.gz'),
  path.resolve(process.cwd(), '.medusa/server/src/data/core-snapshots.json.gz'),
];

async function loadBundle(): Promise<Bundle> {
  for (const p of DATA_PATH_CANDIDATES) {
    try {
      const buf = await fs.readFile(p);
      const json = gunzipSync(buf).toString('utf-8');
      return JSON.parse(json) as Bundle;
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  }
  throw new Error(`core-snapshots.json.gz not found in any of: ${DATA_PATH_CANDIDATES.join(', ')}`);
}

async function loadProgress(): Promise<Set<string>> {
  if (process.env.BACKFILL_RESUME !== 'true') return new Set();
  try {
    const buf = await fs.readFile(PROGRESS_PATH, 'utf-8');
    const arr = JSON.parse(buf) as string[];
    return new Set(arr);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return new Set();
    throw e;
  }
}

async function saveProgress(processed: Set<string>): Promise<void> {
  await fs.writeFile(PROGRESS_PATH, JSON.stringify(Array.from(processed)));
}

async function appendFailure(masterId: string, error: unknown): Promise<void> {
  const entry = {
    masterId,
    at: new Date().toISOString(),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
  };
  let existing: any[] = [];
  try {
    existing = JSON.parse(await fs.readFile(FAILURES_PATH, 'utf-8'));
  } catch {
    /* first failure */
  }
  existing.push(entry);
  await fs.writeFile(FAILURES_PATH, JSON.stringify(existing, null, 2));
}

export default async function backfill({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  // PRODUCT 모듈이 product + category 모두 담당 (별도 PRODUCT_CATEGORY 모듈 없음).
  const productModule = container.resolve(Modules.PRODUCT);
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);

  const limit = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : Infinity;
  const batchSize = process.env.BACKFILL_BATCH_SIZE ? parseInt(process.env.BACKFILL_BATCH_SIZE, 10) : 50;

  logger.info('[backfill] Loading bundle...');
  const bundle = await loadBundle();
  logger.info(
    `[backfill] Loaded ${bundle.snapshots.length} snapshots (extractedAt=${bundle.meta.extractedAt}, source=${bundle.meta.sourceHost})`,
  );

  // ── 1. Default Sales Channel ──────────────────────────────────────────
  const [defaultSc] = await salesChannelModule.listSalesChannels({ name: 'Default Sales Channel' });
  if (!defaultSc) {
    throw new Error('[backfill] Default Sales Channel not found. Run seed.ts first.');
  }
  logger.info(`[backfill] Using sales channel: ${defaultSc.id}`);

  // ── 2. 카테고리 캐시 prime ────────────────────────────────────────────
  // 기존 카테고리: handle 또는 metadata.pimCategoryId 로 조회 가능하게 매핑.
  const categoryCache = new Map<string, string>(); // pimCategoryId → medusa id
  {
    const limit_ = 100;
    let offset = 0;
    while (true) {
      // metadata 는 listProductCategories 기본 응답에 안 실려 select 로 명시.
      const cats = await productModule.listProductCategories(
        {},
        { take: limit_, skip: offset, select: ['id', 'handle', 'metadata'] },
      );
      if (!cats.length) break;
      for (const c of cats) {
        const meta = (c.metadata as any) || {};
        if (meta.pimCategoryId) categoryCache.set(meta.pimCategoryId, c.id);
        if (c.handle) categoryCache.set(c.handle, c.id);
        if (meta.pimSlug) categoryCache.set(meta.pimSlug, c.id);
      }
      if (cats.length < limit_) break;
      offset += limit_;
    }
    logger.info(`[backfill] Category cache primed: ${categoryCache.size} keys`);
  }

  // 누락 카테고리 부모→자식 순서로 보장.
  // snapshot.categories 가 categoryIds 와 같은 순서로 들어 있다는 보장이 없으므로
  // 모든 snapshot 의 categories 를 모은 뒤 parent dependency 그래프로 정렬.
  const allCats = new Map<string, NonNullable<PimProductSnapshot['categories']>[number]>();
  for (const s of bundle.snapshots) {
    for (const c of s.categories || []) {
      if (!allCats.has(c.id)) allCats.set(c.id, c);
    }
  }

  const ensureCategory = async (
    cat: NonNullable<PimProductSnapshot['categories']>[number],
    visiting: Set<string> = new Set(),
  ): Promise<string> => {
    if (categoryCache.has(cat.id)) return categoryCache.get(cat.id)!;
    if (visiting.has(cat.id)) {
      throw new Error(`[backfill] Category cycle detected at ${cat.id}`);
    }
    visiting.add(cat.id);

    let parentMedusaId: string | undefined;
    if (cat.parentId) {
      const parent = allCats.get(cat.parentId);
      if (parent) {
        parentMedusaId = await ensureCategory(parent, visiting);
      }
    }

    const handle = cat.slug || cat.id;
    const isActive = cat.isActive && cat.visibility;
    const created = await productModule.createProductCategories({
      name: cat.name,
      handle,
      is_active: isActive,
      parent_category_id: parentMedusaId,
      metadata: {
        pimCategoryId: cat.id,
        pimSlug: cat.slug,
        pimPath: cat.path,
        pimVisibility: cat.visibility,
        pimShowOnMainCategory: cat.showOnMainCategory,
      },
    });
    categoryCache.set(cat.id, created.id);
    if (handle) categoryCache.set(handle, created.id);
    logger.info(`[backfill] Created category ${cat.name} (${cat.id}) → ${created.id}`);
    return created.id;
  };

  for (const c of allCats.values()) {
    if (!categoryCache.has(c.id)) {
      try {
        await ensureCategory(c);
      } catch (err: any) {
        logger.warn(`[backfill] Category ensure failed for ${c.id}: ${err?.message}`);
      }
    }
  }

  // ── 2-1. 태그 prime ───────────────────────────────────────────────────
  // workflow input 은 tag_ids: string[] 를 요구하므로 value → id 맵을 미리 만들어 둔다.
  // 누락 태그는 일괄 createProductTags 로 보충. (Admin REST 경로는 tags: [{value}] 로 자동 ensure
  // 되지만 모듈 DTO 경로는 그렇지 않다.)
  const tagCache = new Map<string, string>(); // tag value → medusa tag id
  {
    const limit_ = 200;
    let offset = 0;
    while (true) {
      const tags = await productModule.listProductTags({}, { take: limit_, skip: offset });
      if (!tags.length) break;
      for (const t of tags) tagCache.set(t.value, t.id);
      if (tags.length < limit_) break;
      offset += limit_;
    }
    const wantedValues = new Set<string>();
    for (const s of bundle.snapshots) {
      for (const v of s.tags || []) wantedValues.add(v);
    }
    const missing = Array.from(wantedValues).filter((v) => !tagCache.has(v));
    if (missing.length > 0) {
      const created = await productModule.createProductTags(missing.map((value) => ({ value })));
      for (const t of created) tagCache.set(t.value, t.id);
    }
    logger.info(`[backfill] Tag cache primed: ${tagCache.size} tags total (${missing.length} created).`);
  }

  // ── 3. 이미 처리된 master 식별 (handle 로 product 존재 검사 + checkpoint 파일) ──
  const processed = await loadProgress();
  if (processed.size > 0) {
    logger.info(`[backfill] Resuming with ${processed.size} already-processed master IDs from ${PROGRESS_PATH}`);
  }

  const existingByHandle = new Set<string>();
  {
    const allHandles = bundle.snapshots.map((s) => s.masterId);
    const chunkSize = 200;
    for (let i = 0; i < allHandles.length; i += chunkSize) {
      const chunk = allHandles.slice(i, i + chunkSize);
      const products = await productModule.listProducts({ handle: chunk }, { select: ['id', 'handle'] });
      for (const p of products) {
        if (p.handle) existingByHandle.add(p.handle);
      }
    }
    logger.info(`[backfill] ${existingByHandle.size} products already exist (handle match)`);
  }

  // ── 4. 백필 루프 ──────────────────────────────────────────────────────
  const todo = bundle.snapshots.filter((s) => !processed.has(s.masterId) && !existingByHandle.has(s.masterId));
  logger.info(`[backfill] To process: ${todo.length} snapshots (limit=${limit}, batch=${batchSize})`);

  let success = 0;
  let skipped = 0;
  let failed = 0;
  const start = Date.now();

  const targetCount = Math.min(todo.length, limit);
  for (let i = 0; i < targetCount; i += batchSize) {
    const slice = todo.slice(i, Math.min(i + batchSize, targetCount));

    // 4a. validation 으로 skip 분리
    const valid: PimProductSnapshot[] = [];
    for (const s of slice) {
      try {
        validatePimSnapshot(s);
        valid.push(s);
      } catch (e) {
        if (e instanceof PimSnapshotValidationError) {
          logger.warn(`[backfill] Skip ${s.masterId}: ${e.message}`);
          skipped += 1;
          processed.add(s.masterId);
        } else {
          throw e;
        }
      }
    }

    if (valid.length === 0) continue;

    // 4b. 변환 + override 주입 (categoryIds → medusa cat ids, sales_channels)
    //     transformer 출력은 Admin REST 모양 → toWorkflowInput 로 모듈 DTO 모양으로 어댑트
    //     (categories→category_ids, tags→tag_ids).
    const inputs = valid.map((snapshot) => {
      const medusaCategoryIds = (snapshot.categoryIds || [])
        .map((pimId) => categoryCache.get(pimId))
        .filter((id): id is string => Boolean(id));
      const payload = transformPimToMedusa(snapshot, {
        categories: medusaCategoryIds.map((id) => ({ id })),
        sales_channels: [defaultSc.id],
      });
      return toWorkflowInput(payload, { resolveTagId: (value) => tagCache.get(value) });
    });

    const markProjectionLinksForHandles = async (handles: string[]) => {
      const ensured = await ensureSellableInventoryProjectionLinks(container, {
        productHandles: handles,
        logger,
      });
      return new Set(
        ensured.products.map((product: { handle?: string | null }) => product.handle).filter(Boolean) as string[],
      );
    };

    // 4c. createProductsWorkflow 일괄 호출
    try {
      await createProductsWorkflow(container).run({
        input: { products: inputs as any },
      });
    } catch (err: any) {
      logger.error(`[backfill] Batch ${i}-${i + slice.length} product creation failed wholesale: ${err?.message}`);
      // 개별 단위 fallback — 어떤 1건이 batch 전체를 망가뜨렸을 수 있음
      for (const snapshot of valid) {
        const medusaCategoryIds = (snapshot.categoryIds || [])
          .map((pimId) => categoryCache.get(pimId))
          .filter((id): id is string => Boolean(id));
        const payload = transformPimToMedusa(snapshot, {
          categories: medusaCategoryIds.map((id) => ({ id })),
          sales_channels: [defaultSc.id],
        });
        const workflowInput = toWorkflowInput(payload, { resolveTagId: (value) => tagCache.get(value) });
        try {
          await createProductsWorkflow(container).run({ input: { products: [workflowInput as any] } });
          const linkedHandles = await markProjectionLinksForHandles([snapshot.masterId]);
          if (!linkedHandles.has(snapshot.masterId)) {
            throw new Error('Projection link repair returned no product for this handle');
          }
          success += 1;
          processed.add(snapshot.masterId);
        } catch (perItemError: any) {
          logger.warn(`[backfill] Failed ${snapshot.masterId}: ${perItemError?.message}`);
          failed += 1;
          await appendFailure(snapshot.masterId, perItemError);
        }
      }
      continue;
    }

    try {
      const linkedHandles = await markProjectionLinksForHandles(valid.map((snapshot) => snapshot.masterId));

      for (const s of valid) {
        if (linkedHandles.has(s.masterId)) {
          success += 1;
          processed.add(s.masterId);
        } else {
          failed += 1;
          await appendFailure(s.masterId, new Error('Projection link repair returned no product for this handle'));
        }
      }
    } catch (err: any) {
      logger.error(`[backfill] Batch ${i}-${i + slice.length} projection link repair failed: ${err?.message}`);
      // 상품 생성은 이미 성공했으므로 product creation 을 재시도하지 않고 projection link 만 개별 재시도한다.
      for (const snapshot of valid) {
        try {
          const linkedHandles = await markProjectionLinksForHandles([snapshot.masterId]);
          if (!linkedHandles.has(snapshot.masterId)) {
            throw new Error('Projection link repair returned no product for this handle');
          }
          success += 1;
          processed.add(snapshot.masterId);
        } catch (perItemError: any) {
          logger.warn(`[backfill] Failed ${snapshot.masterId}: ${perItemError?.message}`);
          failed += 1;
          await appendFailure(snapshot.masterId, perItemError);
        }
      }
    }

    await saveProgress(processed);

    const done = success + skipped + failed;
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const remaining = targetCount - done;
    const eta = rate > 0 ? remaining / rate : 0;
    logger.info(
      `[backfill] Progress: ${done}/${targetCount} (success=${success}, skipped=${skipped}, failed=${failed}) ` +
        `rate=${rate.toFixed(2)}/s ETA=${(eta / 60).toFixed(1)}m`,
    );
  }

  const total = success + skipped + failed;
  logger.info(`[backfill] === Done ===`);
  logger.info(`  Total: ${total} (success=${success}, skipped=${skipped}, failed=${failed})`);
  logger.info(`  Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  if (failed > 0) {
    logger.info(`  Failures: ${FAILURES_PATH}`);
  }
}
