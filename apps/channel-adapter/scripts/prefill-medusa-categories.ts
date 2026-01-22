#!/usr/bin/env ts-node

// ========================================================================
// PIMCLIENT: MIGRATION SCRIPT ONLY
// ========================================================================
// This script is allowed to use PimClient for direct PIM API access.
// This is an exception to the MSA boundary rule and should ONLY be used for:
// - One-time data migration/backfill operations
// - Administrative/debugging tasks
// - NOT for regular operational code
// ========================================================================

/**
 * PIM 카테고리를 Medusa에 선행 생성/동기화합니다.
 * - PIM /categories 목록을 가져와 parent → child 순서로 ensureCategoryTree 실행
 * - 이미 존재하면 스킵, 없으면 생성
 *
 * 실행 예시:
 * PIM_API_URL=... MEDUSA_API_URL=... MEDUSA_API_KEY=... FILE_SERVICE_URL=http://dummy.com \
 *   npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/prefill-medusa-categories.ts
 */

import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PimClient } from '../src/services/pim-medusa-sync/pim.client';
import { MedusaClient } from '../src/services/pim-medusa-sync/medusa.client';
import * as postgres from 'postgres';

type PimCategory = {
    id: string;
    parentId: string | null;
    name?: string;
};

async function main() {
    const required = ['PIM_API_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY'];
    for (const key of required) {
        if (!process.env[key]) {
            throw new Error(`Missing env: ${key}`);
        }
    }

    const config = new ConfigService({
        PIM_API_URL: process.env.PIM_API_URL,
        MEDUSA_API_URL: process.env.MEDUSA_API_URL,
        MEDUSA_API_KEY: process.env.MEDUSA_API_KEY,
        FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://dummy.com',
    });

    const pimClient = new PimClient(config);
    const medusaClient = new MedusaClient(config);

    // 캐시 초기화
    console.log('Clearing all caches before prefill...');
    medusaClient.clearAllCaches();

    console.log('📂 Fetching PIM categories...');
    const categories = process.env.PIM_SOURCE_DB_URL
        ? await fetchPimCategoriesFromDb(process.env.PIM_SOURCE_DB_URL)
        : await fetchPimCategories(config.get<string>('PIM_API_URL')!);
    console.log(`Found ${categories.length} categories.`);

    // 부모 먼저, 자식 나중 순서대로 처리하기 위해 depth 순 정렬
    const sorted = sortByParentFirst(categories);

    let created = 0;
    for (const cat of sorted) {
        try {
            await medusaClient.ensureCategoryTree(cat.id, (id) => pimClient.getCategory(id));
            created += 1;
            if (created % 50 === 0) {
                console.log(`Processed ${created}/${sorted.length} categories...`);
            }
        } catch (e: any) {
            console.error(`Failed to ensure category ${cat.id}:`, e?.message || e);
        }
    }

    console.log(`✅ Category prefill done. Total processed: ${created}`);
}

async function fetchPimCategories(apiUrl: string): Promise<PimCategory[]> {
    const limit = 500;
    let page = 1;
    const all: PimCategory[] = [];

    while (true) {
        const res = await axios.get(`${apiUrl}/categories`, {
            params: { limit, page },
        });
        const data = res.data?.categories || res.data?.data || [];
        if (!data.length) break;

        all.push(
            ...data.map((c: any) => ({
                id: c.id,
                parentId: c.parentId ?? null,
                name: c.name,
            })),
        );

        if (data.length < limit) break;
        page += 1;
    }
    return all;
}

function sortByParentFirst(categories: PimCategory[]): PimCategory[] {
    const map = new Map<string, PimCategory>();
    categories.forEach((c) => map.set(c.id, c));

    const result: PimCategory[] = [];
    const visited = new Set<string>();

    function dfs(cat: PimCategory) {
        if (visited.has(cat.id)) return;
        if (cat.parentId && map.has(cat.parentId)) {
            dfs(map.get(cat.parentId)!);
        }
        visited.add(cat.id);
        result.push(cat);
    }

    categories.forEach(dfs);
    return result;
}

// DB 직연결로 카테고리 조회 (PIM_SOURCE_DB_URL 제공 시)
async function fetchPimCategoriesFromDb(dbUrl: string): Promise<PimCategory[]> {
    console.log(`Using PIM DB for categories: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
    const createSql = (postgres as any).default ?? (postgres as any);
    const sql = createSql(dbUrl, { max: 1 });
    try {
        // 일부 DB는 snake_case, 일부는 camelCase 필드를 가짐. 필드 존재 여부를 확인 후 쿼리.
        const hasCategories = await sql`
            SELECT 1
            FROM information_schema.tables
            WHERE table_name = 'categories'
            LIMIT 1
        `;
        if (hasCategories.length) {
            const rows = await sql<PimCategory[]>`
                SELECT id, parent_id as "parentId", name
                FROM categories
                ORDER BY sort_order NULLS LAST, created_at
            `;
            return rows;
        }

        // fallback: product_categories 테이블 사용 (deleted_at 없을 수 있음)
        const rows = await sql<PimCategory[]>`
            SELECT id, parent_id as "parentId", name
            FROM product_categories
            ORDER BY sort_order NULLS LAST, created_at
        `;
        return rows;
    } finally {
        await sql.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
