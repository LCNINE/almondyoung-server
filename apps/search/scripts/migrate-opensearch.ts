#!/usr/bin/env ts-node

/**
 * OpenSearch 클러스터 간 인덱스 이관 (Railway → AWS VPC 도메인).
 *
 * 스냅샷 복원이 아니라 문서를 «다시 색인»한다. 그래서
 *  - 인덱스 설정·매핑은 소스에서 복사하지 않고 이 저장소의 상수에서 만든다. 소스가 드리프트해
 *    있어도 새 클러스터는 앱이 기대하는 모양으로 선다.
 *  - 소스와 대상의 엔진 버전이 달라도 상관없다 (2026-09 기준 소스 2.18 / 대상 2.17).
 *  - `_source` 를 그대로 옮기므로 상품명 벡터(name_vector)가 보존된다 — 재임베딩 비용이 없다.
 *
 * 소스 `_id` 를 그대로 써서 bulk index 하므로 **여러 번 돌려도 안전**하다(같은 문서를 덮어쓴다).
 * 중간에 끊기면 그냥 다시 돌리면 된다.
 *
 * 대상이 VPC 안이라 이 스크립트는 VPC 에 닿는 자리에서 돌려야 한다. SSM 포트포워딩으로
 * localhost 에 뚫어 쓰는 경우 인증서 호스트명이 안 맞으므로 TARGET_TLS_INSECURE=1 을 준다.
 *
 * 실행 절차: docs/runbooks/opensearch-railway-to-aws.md
 */

import { Client } from '@opensearch-project/opensearch';
import {
  DEFAULT_PRODUCTS_INDEX,
  PRODUCTS_INDEX_MAPPINGS,
  PRODUCTS_INDEX_SETTINGS,
} from '../src/types/product-document.type';
import {
  DEFAULT_QUERY_EVENTS_INDEX,
  QUERY_EVENTS_INDEX_MAPPINGS,
  QUERY_EVENTS_INDEX_SETTINGS,
} from '../src/types/query-keyword-document.type';

type IndexPlan = {
  name: string;
  settings: Record<string, unknown>;
  mappings: Record<string, unknown>;
};

type Options = {
  indices: string[];
  batchSize: number;
  dryRun: boolean;
  scrollTtl: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 가 필요합니다`);
  return value;
}

function buildClient(prefix: 'SOURCE' | 'TARGET'): Client {
  const node = requireEnv(`${prefix}_OPENSEARCH_NODE`);
  const username = process.env[`${prefix}_OPENSEARCH_USERNAME`];
  const password = process.env[`${prefix}_OPENSEARCH_PASSWORD`];
  // SSM 터널을 거치면 인증서의 호스트명이 localhost 와 안 맞는다. 그 경우에만 켠다.
  const insecure = process.env[`${prefix}_TLS_INSECURE`] === '1';

  return new Client({
    node,
    auth: username && password ? { username, password } : undefined,
    ...(insecure ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const found = args.find((arg) => arg.startsWith(`${name}=`));
    return found ? found.slice(name.length + 1) : undefined;
  };

  const productsIndex = process.env.SEARCH_PRODUCTS_INDEX || DEFAULT_PRODUCTS_INDEX;
  const queryEventsIndex = process.env.SEARCH_QUERY_EVENTS_INDEX || DEFAULT_QUERY_EVENTS_INDEX;

  const requested = value('--indices');
  const indices = requested
    ? requested
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [productsIndex, queryEventsIndex];

  const batchSizeRaw = value('--batch-size');
  const batchSize = batchSizeRaw === undefined ? 500 : Number(batchSizeRaw);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('--batch-size 는 1 이상 정수여야 합니다');
  }

  return {
    indices,
    batchSize,
    dryRun: args.includes('--dry-run'),
    scrollTtl: value('--scroll-ttl') ?? '5m',
  };
}

function planFor(indexName: string): IndexPlan {
  const productsIndex = process.env.SEARCH_PRODUCTS_INDEX || DEFAULT_PRODUCTS_INDEX;
  const queryEventsIndex = process.env.SEARCH_QUERY_EVENTS_INDEX || DEFAULT_QUERY_EVENTS_INDEX;

  if (indexName === productsIndex) {
    return {
      name: indexName,
      settings: PRODUCTS_INDEX_SETTINGS,
      mappings: PRODUCTS_INDEX_MAPPINGS as Record<string, unknown>,
    };
  }
  if (indexName === queryEventsIndex) {
    return {
      name: indexName,
      settings: QUERY_EVENTS_INDEX_SETTINGS,
      mappings: QUERY_EVENTS_INDEX_MAPPINGS as Record<string, unknown>,
    };
  }
  throw new Error(
    `${indexName} 의 설정·매핑을 이 저장소에서 찾을 수 없습니다. ` +
      `이관 대상은 ${productsIndex} · ${queryEventsIndex} 뿐입니다.`,
  );
}

async function countDocs(client: Client, index: string): Promise<number> {
  const response = await client.count({ index });
  return response.body.count as number;
}

async function ensureTargetIndex(target: Client, plan: IndexPlan, dryRun: boolean): Promise<void> {
  const exists = await target.indices.exists({ index: plan.name });
  if (exists.body) {
    console.log(`  대상에 ${plan.name} 이미 있음 — 생성 건너뜀 (문서는 덮어쓰기로 채운다)`);
    return;
  }
  if (dryRun) {
    console.log(`  [dry-run] ${plan.name} 을 저장소 상수의 설정·매핑으로 생성했을 것`);
    return;
  }
  await target.indices.create({
    index: plan.name,
    body: { settings: plan.settings, mappings: plan.mappings },
  });
  console.log(`  ${plan.name} 생성 완료 (설정·매핑은 저장소 상수)`);
}

export async function copyIndex(source: Client, target: Client, plan: IndexPlan, options: Options): Promise<void> {
  const sourceTotal = await countDocs(source, plan.name);
  console.log(`\n[${plan.name}] 소스 문서 ${sourceTotal.toLocaleString()}건`);

  await ensureTargetIndex(target, plan, options.dryRun);

  if (sourceTotal === 0) {
    console.log('  소스가 비어 있어 복사할 것이 없습니다');
    return;
  }

  let scrollId: string | undefined;
  let copied = 0;
  let failed = 0;
  let skipped = 0;

  try {
    let response = await source.search({
      index: plan.name,
      scroll: options.scrollTtl,
      size: options.batchSize,
      body: { query: { match_all: {} }, sort: ['_doc'] },
    });

    while (true) {
      scrollId = response.body._scroll_id;
      const rawHits: Array<{ _id: string; _source?: Record<string, unknown> }> = response.body.hits.hits;
      if (rawHits.length === 0) break;

      // _source 가 없는 히트는 옮길 내용이 없다. 조용히 건너뛰지 않고 세어서 마지막 검증에
      // 드러나게 둔다 — 문서 수가 안 맞으면 그게 신호다.
      const hits = rawHits.filter(
        (hit): hit is { _id: string; _source: Record<string, unknown> } => hit._source !== undefined,
      );
      const missingSource = rawHits.length - hits.length;
      if (missingSource > 0) {
        skipped += missingSource;
        console.error(`\n  _source 없는 문서 ${missingSource}건 건너뜀`);
      }

      if (options.dryRun) {
        copied += hits.length;
      } else {
        // 소스 _id 를 그대로 쓴다 — 재실행이 중복을 만들지 않고 덮어쓴다.
        const operations: Record<string, unknown>[] = hits.flatMap((hit) => [
          { index: { _index: plan.name, _id: hit._id } },
          hit._source,
        ]);
        const bulk = await target.bulk({ refresh: false, body: operations });
        const items = bulk.body.items as Array<{ index?: { status?: number; error?: unknown; _id?: string } }>;
        let batchCopied = 0;
        let batchFailed = 0;
        for (const item of items ?? []) {
          const result = item.index;
          if (result && !result.error && result.status !== undefined && result.status >= 200 && result.status < 300) {
            batchCopied += 1;
          } else if (failed + ++batchFailed <= 5) {
            console.error(`  색인 실패 _id=${result?._id}: ${JSON.stringify(result?.error ?? result?.status)}`);
          }
        }
        // 누적 실패를 매 배치에서 다시 빼면 진행 건수도 틀어진다.
        copied += batchCopied;
        failed += hits.length - batchCopied;
      }

      process.stdout.write(`\r  복사 ${copied.toLocaleString()} / ${sourceTotal.toLocaleString()}`);

      response = await source.scroll({ scroll_id: scrollId, scroll: options.scrollTtl });
    }
    process.stdout.write('\n');
  } finally {
    if (scrollId) {
      await source.clearScroll({ body: { scroll_id: [scrollId] } }).catch(() => undefined);
    }
  }

  if (failed > 0) {
    console.error(`  색인 실패 ${failed}건 — 다시 실행하면 성공한 문서는 덮어쓰고 실패분만 재시도됩니다`);
  }
  if (skipped > 0) {
    console.error(`  _source 없어 건너뛴 문서 ${skipped}건`);
  }

  // 기존 대상 문서 수가 충분해도 덮어쓰기가 실패했으면 데이터가 최신이라는 보장은 없다.
  if (failed > 0 || skipped > 0) {
    throw new Error(`${plan.name} 복사 불완전: 색인 실패 ${failed}건, _source 누락 ${skipped}건`);
  }

  if (options.dryRun) {
    console.log(`  [dry-run] ${copied.toLocaleString()}건을 복사했을 것`);
    return;
  }

  await target.indices.refresh({ index: plan.name });
  const targetTotal = await countDocs(target, plan.name);

  // 판정은 «같다» 가 아니라 «대상이 소스를 포함한다» 여야 한다. 컷오버 뒤 꼬리 복사를 돌리면
  // 대상에는 전환 후 새로 들어온 문서가 있어 소스보다 많은 게 «정상»이다. 같기를 요구하면
  // 정상인 회차를 실패로 보고하고, 그걸 본 사람이 이미 옮겨진 데이터를 의심하게 된다.
  const surplus = targetTotal - sourceTotal;
  const verdict =
    surplus === 0
      ? '일치'
      : surplus > 0
        ? `대상이 ${surplus.toLocaleString()}건 많음 (전환 후 유입)`
        : '🔴 대상이 모자람';
  console.log(`  검증: 소스 ${sourceTotal.toLocaleString()} / 대상 ${targetTotal.toLocaleString()} — ${verdict}`);
  if (targetTotal < sourceTotal) {
    throw new Error(`${plan.name} 이 소스보다 적습니다. 다시 실행해 채운 뒤 이 줄을 확인하세요.`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const source = buildClient('SOURCE');
  const target = buildClient('TARGET');

  try {
    console.log(`소스   ${requireEnv('SOURCE_OPENSEARCH_NODE')}`);
    console.log(`대상   ${requireEnv('TARGET_OPENSEARCH_NODE')}`);
    console.log(`인덱스 ${options.indices.join(', ')}${options.dryRun ? '  (dry-run)' : ''}`);

    const sourceHealth = await source.cluster.health();
    const targetHealth = await target.cluster.health();
    console.log(`상태   소스 ${sourceHealth.body.status} / 대상 ${targetHealth.body.status}`);

    for (const indexName of options.indices) {
      await copyIndex(source, target, planFor(indexName), options);
    }

    console.log('\n이관 완료');
  } finally {
    await Promise.allSettled([source.close(), target.close()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\n이관 실패:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
