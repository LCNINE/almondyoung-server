#!/usr/bin/env ts-node

// tsconfig-paths 명시적 초기화
import { register } from 'tsconfig-paths';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const tsConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tsconfig.json'), 'utf8')
);

register({
  baseUrl: resolve(__dirname, '../../../'),
  paths: tsConfig.compilerOptions.paths,
});

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PimModule } from '../src/pim.module';
import { ElasticsearchService } from '../src/search/elasticsearch.service';
import { ElasticsearchIndexService } from '../src/search/elasticsearch-index.service';
import { DbService } from '@app/db';
import {
  productMasterVersions,
  productCategories,
  productMasterCategories,
  productTagValues,
  tagValues,
  tagGroups,
  type PimSchema
} from '../src/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ElasticsearchProductDocument } from '../src/search/types/index-mappings';

async function bootstrap() {
  console.log('🚀 Starting Elasticsearch migration...\n');

  const app = await NestFactory.createApplicationContext(PimModule, {
    logger: ['error', 'warn', 'log'],
  });

  const configService = app.get(ConfigService);
  const esService = app.get(ElasticsearchService);
  const esIndexService = app.get(ElasticsearchIndexService);
  const dbService = app.get<DbService<PimSchema>>(DbService);

  // 🔍 데이터베이스 연결 정보 출력
  const databaseUrl = configService.get<string>('DATABASE_URL');
  console.log('\n🔍 Database Connection Info:');
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      console.log(`  - Protocol: ${url.protocol}`);
      console.log(`  - Host: ${url.hostname}`);
      console.log(`  - Port: ${url.port || 'default'}`);
      console.log(`  - Database: ${url.pathname.substring(1)}`);
      console.log(`  - Username: ${url.username}`);
      console.log(`  - Full URL (masked): ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
    } catch (e) {
      console.log(`  - Raw URL (masked): ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
    }
  } else {
    console.log('  ⚠️  DATABASE_URL not found in config!');
  }

  // 🔍 실제 DB에 있는 테이블 확인
  console.log('\n🔍 Checking actual tables in database:');
  try {
    const db = dbService.db;

    // PostgreSQL 시스템 카탈로그에서 테이블 목록 조회
    const tables = await db.execute<{ schemaname: string; tablename: string }>(sql`
      SELECT 
        schemaname,
        tablename 
      FROM pg_catalog.pg_tables 
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename;
    `);

    console.log(`  Found ${tables.length} tables total`);

    // product_master 관련 테이블 특별히 확인
    console.log('\n  🔍 Checking product_master* tables:');
    const productTables = await db.execute<{ tablename: string; schemaname: string }>(sql`
      SELECT tablename, schemaname 
      FROM pg_catalog.pg_tables 
      WHERE tablename LIKE 'product_master%'
      ORDER BY tablename;
    `);

    if (productTables.length === 0) {
      console.log('    ⚠️  No product_master* tables found!');
    } else {
      productTables.forEach((row) => {
        console.log(`    ✓ ${row.schemaname}.${row.tablename}`);
      });
    }

    // 현재 search_path 확인
    const searchPath = await db.execute<{ search_path: string }>(sql`SHOW search_path;`);
    console.log(`\n  📍 Current search_path: ${searchPath[0]?.search_path}`);

    // 모든 테이블 리스트 (디버깅용)
    console.log('\n  📋 All non-system tables:');
    tables.forEach((row) => {
      console.log(`    - ${row.schemaname}.${row.tablename}`);
    });

  } catch (error: any) {
    console.error('  ❌ Failed to query tables:', error.message);
  }
  console.log('');

  try {
    console.log('📋 Step 1: Creating Elasticsearch index...');
    await esIndexService.createProductsIndex();
    console.log('✅ Index created\n');

    console.log('📋 Step 2: Fetching active product masters from PostgreSQL...');
    const db = dbService.db;

    const activeMasters = await db
      .select({
        id: productMasterVersions.id,
        masterId: productMasterVersions.masterId,
        version: productMasterVersions.version,
        name: productMasterVersions.name,
      })
      .from(productMasterVersions)
      .where(
        and(
          eq(productMasterVersions.versionStatus, 'active'),
          isNull(productMasterVersions.deletedAt),
        ),
      );

    console.log(`Found ${activeMasters.length} active product masters\n`);

    if (activeMasters.length === 0) {
      console.log('⚠️  No active products to migrate');
      await app.close();
      return;
    }

    console.log('📋 Step 3: Migrating products to Elasticsearch...');
    let migrated = 0;
    let failed = 0;

    for (const master of activeMasters) {
      try {
        const document = await buildElasticsearchDocument(
          db,
          master.id,
          master.version,
          master.masterId,
        );

        await esService.getClient().index({
          index: 'pim_products',
          id: master.masterId,
          document,
        });

        migrated++;
        if (migrated % 10 === 0) {
          console.log(`  Migrated ${migrated}/${activeMasters.length} products...`);
        }
      } catch (error) {
        failed++;
        console.error(
          `  ❌ Failed to migrate product ${master.masterId}: ${error.message}`,
        );
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`  - Migrated: ${migrated} products`);
    console.log(`  - Failed: ${failed} products`);
    console.log(`  - Total: ${activeMasters.length} products`);

    console.log('\n📋 Step 4: Verifying Elasticsearch index...');
    const count = await esService.getClient().count({
      index: 'pim_products',
    });
    console.log(`✅ Elasticsearch index contains ${count.count} documents\n`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

async function buildElasticsearchDocument(
  db: PostgresJsDatabase<PimSchema>,
  productId: string,
  version: number,
  masterId: string,
): Promise<ElasticsearchProductDocument> {
  // 상품 기본 정보 + 카테고리 정보 조회 (productMasterCategories join)
  const [product] = await db
    .select({
      id: productMasterVersions.id,
      masterId: productMasterVersions.masterId,
      version: productMasterVersions.version,
      name: productMasterVersions.name,
      description: productMasterVersions.description,
      productCode: productMasterVersions.productCode,
      brand: productMasterVersions.brand,
      status: productMasterVersions.status,
      approvalStatus: productMasterVersions.approvalStatus,
      marketPrice: productMasterVersions.marketPrice,
      categoryId: productCategories.id,
      categoryName: productCategories.name,
      categoryPath: productCategories.path,
      createdAt: productMasterVersions.createdAt,
      updatedAt: productMasterVersions.updatedAt,
    })
    .from(productMasterVersions)
    .leftJoin(
      productMasterCategories,
      and(
        eq(productMasterVersions.masterId, productMasterCategories.masterId),
        eq(productMasterVersions.version, productMasterCategories.version),
      ),
    )
    .leftJoin(
      productCategories,
      eq(productMasterCategories.categoryId, productCategories.id),
    )
    .where(eq(productMasterVersions.id, productId))
    .limit(1);

  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  const tagsData = await db
    .select({
      groupId: tagGroups.id,
      groupName: tagGroups.name,
      valueId: tagValues.id,
      valueName: tagValues.name,
      groupDisplayOrder: tagGroups.displayOrder,
      valueDisplayOrder: tagValues.displayOrder,
    })
    .from(productTagValues)
    .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
    .innerJoin(tagGroups, eq(tagValues.groupId, tagGroups.id))
    .where(
      and(
        eq(productTagValues.masterId, masterId),
        eq(productTagValues.version, version),
        eq(tagGroups.isActive, true),
        eq(tagValues.isActive, true),
      ),
    )
    .orderBy(tagGroups.displayOrder, tagValues.displayOrder);

  const tags = tagsData.map((tag) => ({
    group_id: tag.groupId,
    group_name: tag.groupName,
    value_id: tag.valueId,
    value_name: tag.valueName,
  }));

  const tagValueIds = tagsData.map((tag) => tag.valueId);

  return {
    master_id: product.masterId,
    product_id: product.id,
    version: product.version,
    name: product.name,
    description: product.description,
    product_code: product.productCode,
    brand: product.brand,
    status: product.status,
    approval_status: product.approvalStatus,
    price: product.marketPrice ? Number(product.marketPrice) : null,
    category_id: product.categoryId ?? null,
    category_name: product.categoryName ?? null,
    category_path: product.categoryPath ?? null,
    tags,
    tag_value_ids: tagValueIds,
    created_at: product.createdAt?.toISOString() || new Date().toISOString(),
    updated_at: product.updatedAt?.toISOString() || new Date().toISOString(),
  };
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

