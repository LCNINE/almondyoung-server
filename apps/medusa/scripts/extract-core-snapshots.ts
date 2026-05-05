#!/usr/bin/env ts-node
/**
 * Core(구 PIM) → Medusa 백필용 스냅샷 추출 도구
 *
 * Build-time (개발자 머신/CI) 에서 실행 → Core DB 의 모든 active master 스냅샷을
 * 정적 JSON.gz 로 dump → Medusa Docker image 빌드 시 image 에 baking.
 * 런타임 (Medusa 컨테이너) 에서는 외부 네트워크 없이 이 파일만 읽어 백필.
 *
 * 사용:
 *   CORE_DB_URL=postgres://... \
 *     npx ts-node -r tsconfig-paths/register apps/medusa/scripts/extract-core-snapshots.ts
 *   # 또는
 *   npm run medusa:backfill:extract
 *
 * 옵션:
 *   --limit=N         테스트용 상한 (기본: 무제한)
 *   --batch-size=N    페이지네이션 단위 (기본: 500)
 *   --out=PATH        출력 경로 (기본: apps/medusa/src/data/core-snapshots.json.gz)
 */

import * as postgres from 'postgres';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { PimSnapshotBuilder } from '../../channel-adapter/scripts/lib/pim-snapshot-builder';
import type { PimProductSnapshot } from '../../channel-adapter/src/types';

interface Args {
  limit?: number;
  batchSize: number;
  out: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(`--${name}=`.length);
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
      return args[idx + 1];
    }
    return undefined;
  };

  const limitRaw = get('limit');
  const batchSizeRaw = get('batch-size');
  const outRaw = get('out');

  return {
    limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
    batchSize: batchSizeRaw ? parseInt(batchSizeRaw, 10) : 500,
    out: outRaw ?? path.resolve(__dirname, '../src/data/core-snapshots.json.gz'),
  };
}

interface Bundle {
  meta: {
    extractedAt: string;
    totalCount: number;
    sourceHost: string;
    schemaVersion: 1;
    note: string;
  };
  snapshots: PimProductSnapshot[];
}

async function main() {
  const opts = parseArgs();
  const dbUrl = process.env.CORE_DB_URL;
  if (!dbUrl) {
    console.error('❌ CORE_DB_URL 환경변수 필요. apps/channel-adapter/.env.migration 확인.');
    process.exit(1);
  }

  console.log('🔌 Connecting to Core DB...');
  const sql = (postgres as any).default ?? postgres;
  const pimDb = sql(dbUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 60,
  });
  const builder = new PimSnapshotBuilder(pimDb);

  const all: PimProductSnapshot[] = [];
  let offset = 0;
  const start = Date.now();

  try {
    while (true) {
      const remaining = opts.limit !== undefined ? opts.limit - all.length : Infinity;
      if (remaining <= 0) break;
      const take = Math.min(opts.batchSize, remaining);

      console.log(`📦 Fetching batch from offset ${offset} (take ${take})...`);
      const batch = await builder.fetchActiveMasters(take, offset);
      if (batch.length === 0) break;
      all.push(...batch);
      offset += batch.length;
      if (batch.length < take) break;
    }

    console.log(`✅ Fetched ${all.length} snapshots in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    const sourceHost = (() => {
      try {
        return new URL(dbUrl.replace(/^postgres(?:ql)?:\/\//, 'http://')).host;
      } catch {
        return 'unknown';
      }
    })();

    const bundle: Bundle = {
      meta: {
        extractedAt: new Date().toISOString(),
        totalCount: all.length,
        sourceHost,
        schemaVersion: 1,
        note: 'Build-time dump for in-process Medusa backfill. Do not commit.',
      },
      snapshots: all,
    };

    const json = JSON.stringify(bundle);
    const gz = gzipSync(Buffer.from(json), { level: 9 });

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, gz);

    console.log(`💾 Wrote ${opts.out} (${(gz.length / 1024 / 1024).toFixed(2)} MB gzip, ${(json.length / 1024 / 1024).toFixed(2)} MB raw)`);
    console.log(`   Total snapshots: ${all.length}`);
    console.log(`   Source: ${sourceHost}`);
  } finally {
    await builder.close();
  }
}

main().catch((err) => {
  console.error('❌ extract-core-snapshots failed:', err);
  process.exit(1);
});
