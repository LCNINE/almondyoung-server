/**
 * 백필 1차 실행분 카테고리/태그 링크 보강 (in-process / Medusa exec)
 *
 * 배경:
 *   `backfill-from-core.ts` 가 transformer 의 Admin 모양(`categories: [{id}]`,
 *   `tags: [{value}]`) 출력을 모듈 DTO 경로(`createProductsWorkflow`) 에 그대로 흘려,
 *   `category_ids` / `tag_ids` 가 누락된 채 product 만 생성됨. 이 스크립트가 이미
 *   만들어진 product 들에 대해 snapshot 의 `categoryIds` / `tags` 를 다시 계산해
 *   `productModule.updateProducts` 로 두 링크를 한 번에 채운다.
 *
 * 멱등성:
 *   현재 product 의 category_ids/tag_ids 와 desired set 이 모두 동일하면 skip.
 *   재실행해도 안전.
 *
 * 사전 조건:
 *   1) `backfill-from-core.ts` 가 한 번 이상 실행되어 product 가 생성돼 있어야 함.
 *   2) image 안에 `core-snapshots.json.gz` 가 baking 되어 있어야 함 (백필과 동일).
 *
 * 실행:
 *   yarn repair:product-links
 *
 * 옵션 (process.env):
 *   REPAIR_LIMIT          — 표본 실행용 상한
 *   REPAIR_BATCH_SIZE     — 한 번에 처리할 product 개수 (기본 50)
 *   REPAIR_RESUME         — 'true' 면 /tmp/repair-progress.json 이어서 실행
 *   REPAIR_SKIP_CATEGORIES — 'true' 면 카테고리는 건드리지 않고 태그만 보강
 *   REPAIR_SKIP_TAGS      — 'true' 면 태그는 건드리지 않고 카테고리만 보강
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PimProductSnapshot } from './lib/transformer';

interface Bundle {
  meta: { extractedAt: string; totalCount: number; sourceHost: string; schemaVersion: number };
  snapshots: PimProductSnapshot[];
}

const PROGRESS_PATH = '/tmp/repair-progress.json';
const FAILURES_PATH = '/tmp/repair-failures.json';
const DATA_PATH_CANDIDATES = [
  path.resolve(__dirname, '../data/core-snapshots.json.gz'),
  path.resolve(process.cwd(), 'src/data/core-snapshots.json.gz'),
  path.resolve(process.cwd(), '.medusa/server/src/data/core-snapshots.json.gz'),
];

async function loadBundle(): Promise<Bundle> {
  for (const p of DATA_PATH_CANDIDATES) {
    try {
      const buf = await fs.readFile(p);
      return JSON.parse(gunzipSync(buf).toString('utf-8')) as Bundle;
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  }
  throw new Error(`core-snapshots.json.gz not found in any of: ${DATA_PATH_CANDIDATES.join(', ')}`);
}

async function loadProgress(): Promise<Set<string>> {
  if (process.env.REPAIR_RESUME !== 'true') return new Set();
  try {
    const buf = await fs.readFile(PROGRESS_PATH, 'utf-8');
    return new Set(JSON.parse(buf) as string[]);
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
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
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

const setEquals = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

export default async function repair({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);

  const limit = process.env.REPAIR_LIMIT ? parseInt(process.env.REPAIR_LIMIT, 10) : Infinity;
  const batchSize = process.env.REPAIR_BATCH_SIZE ? parseInt(process.env.REPAIR_BATCH_SIZE, 10) : 50;
  const repairCategories = process.env.REPAIR_SKIP_CATEGORIES !== 'true';
  const repairTags = process.env.REPAIR_SKIP_TAGS !== 'true';
  if (!repairCategories && !repairTags) {
    throw new Error('[repair] Both REPAIR_SKIP_CATEGORIES and REPAIR_SKIP_TAGS set — nothing to do.');
  }

  logger.info(
    `[repair] Mode: categories=${repairCategories ? 'on' : 'off'} tags=${repairTags ? 'on' : 'off'}`,
  );
  logger.info('[repair] Loading bundle...');
  const bundle = await loadBundle();
  logger.info(
    `[repair] Loaded ${bundle.snapshots.length} snapshots (extractedAt=${bundle.meta.extractedAt}).`,
  );

  // ── 1. 카테고리 캐시 prime: pimCategoryId → medusa id ────────────────
  const categoryCache = new Map<string, string>();
  if (repairCategories) {
    const limit_ = 200;
    let offset = 0;
    while (true) {
      const cats = await productModule.listProductCategories({}, { take: limit_, skip: offset });
      if (!cats.length) break;
      for (const c of cats) {
        const meta = (c.metadata as any) || {};
        if (meta.pimCategoryId) categoryCache.set(meta.pimCategoryId, c.id);
      }
      if (cats.length < limit_) break;
      offset += limit_;
    }
    logger.info(`[repair] Category cache primed: ${categoryCache.size} pim→medusa mappings.`);
    if (categoryCache.size === 0) {
      throw new Error(
        '[repair] No categories with metadata.pimCategoryId found. Run backfill-from-core.ts first to seed categories.',
      );
    }
  }

  // ── 1-1. 태그 캐시 prime: tag value → medusa tag id ──────────────────
  // 누락 태그는 보강을 위해 미리 createProductTags 로 채워둔다 (백필 어댑터 도입 전 분).
  const tagCache = new Map<string, string>();
  if (repairTags) {
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
    for (const s of bundle.snapshots) for (const v of s.tags || []) wantedValues.add(v);
    const missing = Array.from(wantedValues).filter((v) => !tagCache.has(v));
    if (missing.length > 0) {
      const created = await productModule.createProductTags(missing.map((value) => ({ value })));
      for (const t of created) tagCache.set(t.value, t.id);
    }
    logger.info(`[repair] Tag cache primed: ${tagCache.size} tags total (${missing.length} created).`);
  }

  // ── 2. snapshot 맵: masterId → 원하는 medusa category/tag id 목록 ──
  const desiredCatsByMaster = new Map<string, string[]>();
  const desiredTagsByMaster = new Map<string, string[]>();
  for (const s of bundle.snapshots) {
    if (repairCategories) {
      const ids = (s.categoryIds || [])
        .map((pimId) => categoryCache.get(pimId))
        .filter((id): id is string => Boolean(id));
      desiredCatsByMaster.set(s.masterId, ids);
    }
    if (repairTags) {
      const ids = (s.tags || [])
        .map((value) => tagCache.get(value))
        .filter((id): id is string => Boolean(id));
      desiredTagsByMaster.set(s.masterId, ids);
    }
  }

  // ── 3. 이미 처리된 master ───────────────────────────────────────────
  const processed = await loadProgress();
  if (processed.size > 0) {
    logger.info(`[repair] Resuming with ${processed.size} already-processed master IDs.`);
  }

  // ── 4. 보강 루프 — Medusa 의 PIM-기원 product 를 페이지네이션 ───────
  let updated = 0;
  let alreadyOk = 0;
  let missingProduct = 0;
  let failed = 0;
  let scanned = 0;
  const start = Date.now();

  // PIM 기원 product 만 대상이 되도록 handle 후보를 스냅샷 기준으로 미리 만들어둠.
  const targetHandles = new Set<string>(bundle.snapshots.map((s) => s.masterId));

  let offset = 0;
  outer: while (true) {
    const relations: string[] = [];
    if (repairCategories) relations.push('categories');
    if (repairTags) relations.push('tags');
    const products = await productModule.listProducts(
      {},
      {
        take: batchSize,
        skip: offset,
        select: ['id', 'handle', 'metadata'],
        relations,
      },
    );
    if (!products.length) break;

    for (const product of products) {
      scanned += 1;
      const handle = product.handle;
      if (!handle) continue;
      // handle === pim masterId (transformer 가 그렇게 고정)
      if (!targetHandles.has(handle)) continue; // PIM 기원이 아닌 product 는 대상 아님
      if (processed.has(handle)) continue;

      const updatePayload: { category_ids?: string[]; tag_ids?: string[] } = {};

      if (repairCategories) {
        const desired = desiredCatsByMaster.get(handle) || [];
        // snapshot 에 카테고리 없음 → 강제 unset 은 위험하니 건드리지 않음
        if (desired.length > 0) {
          const currentIds = new Set<string>((product.categories || []).map((c: any) => c.id));
          const desiredSet = new Set(desired);
          if (!setEquals(currentIds, desiredSet)) {
            updatePayload.category_ids = desired;
          }
        }
      }

      if (repairTags) {
        const desired = desiredTagsByMaster.get(handle) || [];
        if (desired.length > 0) {
          const currentIds = new Set<string>((product.tags || []).map((t: any) => t.id));
          const desiredSet = new Set(desired);
          if (!setEquals(currentIds, desiredSet)) {
            updatePayload.tag_ids = desired;
          }
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        alreadyOk += 1;
        processed.add(handle);
        continue;
      }

      try {
        await productModule.updateProducts(product.id, updatePayload);
        updated += 1;
        processed.add(handle);
      } catch (err: any) {
        logger.warn(`[repair] Failed ${handle} (${product.id}): ${err?.message}`);
        failed += 1;
        await appendFailure(handle, err);
      }

      if (updated + alreadyOk + failed >= limit) break outer;
    }

    await saveProgress(processed);

    const done = updated + alreadyOk + failed;
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / Math.max(elapsed, 0.001);
    logger.info(
      `[repair] Progress: scanned=${scanned} updated=${updated} alreadyOk=${alreadyOk} failed=${failed} ` +
        `rate=${rate.toFixed(2)}/s`,
    );

    if (products.length < batchSize) break;
    offset += products.length;
  }

  // ── 5. 누락 product 검사 — snapshot 에는 있는데 Medusa 에 없는 master
  for (const masterId of targetHandles) {
    if (!processed.has(masterId)) {
      const exists = await productModule.listProducts({ handle: [masterId] }, { select: ['id'] });
      if (!exists.length) missingProduct += 1;
    }
  }

  await saveProgress(processed);

  logger.info(`[repair] === Done ===`);
  logger.info(
    `  Scanned: ${scanned}, updated: ${updated}, alreadyOk: ${alreadyOk}, failed: ${failed}, missingInMedusa: ${missingProduct}`,
  );
  logger.info(`  Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  if (failed > 0) logger.info(`  Failures: ${FAILURES_PATH}`);
}
