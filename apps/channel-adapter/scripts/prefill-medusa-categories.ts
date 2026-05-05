#!/usr/bin/env ts-node

/**
 * Core(구 PIM) 카테고리를 Medusa 에 선행 동기화한다.
 * - Core DB 의 product_categories 를 한 번에 읽어 부모→자식 순으로 ensureCategoryFromSnapshot 실행.
 * - product backfill 과 동일한 식별자 규약(handle=slug||id, metadata.pimCategoryId)을 사용한다.
 *
 * 환경변수:
 *   CORE_DB_URL        Core(구 PIM) DB connection string  (필수)
 *   MEDUSA_API_URL     Medusa Admin URL                    (필수)
 *   MEDUSA_API_KEY     Medusa secret API key               (필수)
 *
 * 실행 예시:
 *   CORE_DB_URL=... MEDUSA_API_URL=... MEDUSA_API_KEY=... \
 *     npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/prefill-medusa-categories.ts
 */

import * as postgres from 'postgres';
import { ConfigService } from '@nestjs/config';
import { MedusaClient } from '../src/adapters/medusa/medusa.client';

type CategorySnapshot = {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  isActive: boolean;
  visibility: boolean;
  showOnMainCategory: boolean;
  thumbnail?: string;
};

async function main() {
  for (const key of ['CORE_DB_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY']) {
    if (!process.env[key]) {
      throw new Error(`Missing env: ${key}`);
    }
  }

  const config = new ConfigService({
    MEDUSA_API_URL: process.env.MEDUSA_API_URL,
    MEDUSA_API_KEY: process.env.MEDUSA_API_KEY,
    FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://dummy.com',
  });

  const medusaClient = new MedusaClient(config);
  medusaClient.clearAllCaches();

  console.log('📂 Fetching categories from Core DB...');
  const sql = (postgres as any).default ?? postgres;
  const pimDb = sql(process.env.CORE_DB_URL!, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 60,
  });

  let categories: CategorySnapshot[];
  try {
    const rows = await pimDb<
      Array<{
        id: string;
        name: string;
        slug: string;
        path: string;
        parent_id: string | null;
        is_active: boolean;
        visibility: boolean;
        display_settings: { showOnMainCategory?: boolean } | null;
        image_url: string | null;
      }>
    >`
      SELECT id, name, slug, path, parent_id, is_active, visibility, display_settings, image_url
      FROM product_categories
      ORDER BY path
    `;
    categories = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      path: r.path,
      parentId: r.parent_id,
      isActive: r.is_active,
      visibility: r.visibility,
      showOnMainCategory: r.display_settings?.showOnMainCategory ?? false,
      thumbnail: r.image_url ?? undefined,
    }));
  } finally {
    await pimDb.end();
  }

  console.log(`Found ${categories.length} categories.`);
  const sorted = sortByParentFirst(categories);

  let success = 0;
  let failed = 0;
  for (const cat of sorted) {
    try {
      await medusaClient.ensureCategoryFromSnapshot(cat);
      success += 1;
      if (success % 50 === 0) {
        console.log(`Processed ${success}/${sorted.length}...`);
      }
    } catch (err: any) {
      failed += 1;
      console.error(`❌ ${cat.id} (${cat.name}):`, err?.message || err);
    }
  }

  console.log(`\n✅ Done. Success: ${success}, Failed: ${failed}`);
}

// 부모가 자식보다 먼저 오도록 위상 정렬. parent 가 입력에 없으면 그대로 둔다(고아 카테고리는 부모 없이 생성).
function sortByParentFirst(categories: CategorySnapshot[]): CategorySnapshot[] {
  const map = new Map<string, CategorySnapshot>();
  categories.forEach((c) => map.set(c.id, c));

  const visited = new Set<string>();
  const result: CategorySnapshot[] = [];

  const visit = (cat: CategorySnapshot) => {
    if (visited.has(cat.id)) return;
    if (cat.parentId && map.has(cat.parentId)) {
      visit(map.get(cat.parentId)!);
    }
    visited.add(cat.id);
    result.push(cat);
  };

  categories.forEach(visit);
  return result;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
