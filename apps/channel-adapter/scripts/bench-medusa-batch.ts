/**
 * Medusa 상품 생성 처리량 벤치마크 — 단건(create) vs 배치(POST /admin/products/batch)
 *
 * 목적: channel-adapter InboxWorker 가 상품 이벤트를 낱개로 처리하는 현재 구조를
 *       배치 호출로 묶었을 때 처리량이 얼마나 오르는지 측정한다.
 *
 * ⚠️ 충실도 — 로컬 측정은 배치 이득을 **과소평가**한다. 세 요인이 모두 같은 방향이다:
 *   - ALB/네트워크 왕복 없음 (배치가 없애는 비용이 로컬에선 ~0)
 *   - DB 가 같은 호스트 (live 는 RDS via proxy)
 *   - taskset 1코어로 묶어도 live 보다 여유 (live Medusa 는 valkey 사이드카와 vCPU 를 공유)
 * 따라서 결과는 하한이다 — 여기서 안 이기면 live 에서도 안 이긴다.
 *
 * 사전 준비:
 *   1. medusa_bench 논리 DB + `medusa db:migrate`
 *   2. `medusa exec ./src/scripts/seed.ts` + `seed-shipping.ts`  (판매채널·리전·배송프로필)
 *   3. `medusa user -e <email> -p <pw>`
 *   4. `taskset -c 0 yarn start`  ← 1 vCPU 재현
 *
 * 실행:
 *   MEDUSA_URL=http://localhost:9000 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     npx tsx apps/channel-adapter/scripts/bench-medusa-batch.ts --n 100 --chunks 10,25,50
 */
import Medusa from '@medusajs/js-sdk';
import { Logger } from '@nestjs/common';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { transformPimToMedusa } from '../src/adapters/medusa/transformers/pim-to-medusa.transformer';
import type { PimProductSnapshot } from '../src/types';

// ---------------------------------------------------------------- args

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MEDUSA_URL = process.env.MEDUSA_URL ?? 'http://localhost:9000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'bench@local.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'bench-password-1';
const N = Number(arg('n', '100'));
const CHUNKS = arg('chunks', '10,25,50')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const BUCKETS = arg('buckets', 'S,M,L').split(',') as BucketName[];
/** live 의 INBOX_MAX_CONCURRENT_HANDLERS 와 동일하게 둔다 */
const SINGLE_CONCURRENCY = Number(arg('concurrency', '2'));
/**
 * 상품 개수가 아니라 **variant 총량**으로 배치를 자르는 arm. 0 이면 비활성.
 * 고정 상품수 청킹은 variant 가 많은 상품에서 역효과가 나므로(배치 호출 하나가
 * 수십초로 늘어남) 총 variant 수를 예산으로 두는 편이 맞는지 검증한다.
 */
const VARIANT_BUDGET = Number(arg('variant-budget', '0'));
const RUN_ID = arg('run', `r${Date.now().toString(36)}`);

// ---------------------------------------------------------------- fixtures

type BucketName = 'S' | 'M' | 'L';

interface BucketSpec {
  name: BucketName;
  /** [옵션 축 이름, 값 개수][] */
  axes: Array<[string, number]>;
  label: string;
}

/**
 * 버킷을 따로 재고 실제 구성비는 사후 가중치로 둔다 — 비율 가정이 측정을 오염시키지 않도록.
 * L 은 variant 30 초과라 MedusaClient.createProductChunked 경로에 해당한다
 * (create 1개 + batchVariants 10개씩). 배치 이득이 가장 적게 나올 버킷.
 */
const BUCKET_SPECS: Record<BucketName, BucketSpec> = {
  S: { name: 'S', axes: [['색상', 4]], label: '옵션1축·variant 4' },
  M: {
    name: 'M',
    axes: [
      ['색상', 4],
      ['사이즈', 5],
    ],
    label: '옵션2축·variant 20',
  },
  L: {
    name: 'L',
    axes: [
      ['컬', 4],
      ['굵기', 4],
      ['길이', 3],
    ],
    label: '옵션3축·variant 48',
  },
};

function combinations(axes: Array<[string, number]>): Array<Array<{ name: string; value: string }>> {
  return axes.reduce<Array<Array<{ name: string; value: string }>>>(
    (acc, [axisName, count]) => {
      const values = Array.from({ length: count }, (_, i) => `${axisName}${i + 1}`);
      return acc.flatMap((combo) => values.map((value) => [...combo, { name: axisName, value }]));
    },
    [[]],
  );
}

function makeSnapshot(bucket: BucketSpec, index: number): PimProductSnapshot {
  // handle 은 transformer 에서 masterId 를 그대로 쓰고, Medusa 는 handle 에 대문자를 거부한다
  // ("Invalid product handle ... It must contain URL safe characters"). 실제 masterId 가
  // 소문자 UUID 라 소문자로 맞추는 것이 프로덕션과도 일치한다.
  const masterId = `${RUN_ID}-${bucket.name.toLowerCase()}-${String(index).padStart(5, '0')}`;
  const combos = combinations(bucket.axes);

  return {
    masterId,
    versionId: `${masterId}-v1`,
    version: 1,
    name: `[bench ${bucket.name}] 상품 ${index}`,
    status: 'active',
    brand: 'BenchBrand',
    productType: 'Unknown',
    fulfillmentKind: 'physical',
    tags: [],
    categories: [],
    categoryIds: [],
    optionGroups: bucket.axes.map(([axisName, count], axisIdx) => ({
      id: `${masterId}-og${axisIdx}`,
      name: axisName,
      values: Array.from({ length: count }, (_, i) => ({
        id: `${masterId}-og${axisIdx}-v${i}`,
        name: `${axisName}${i + 1}`,
      })),
    })),
    variants: combos.map((combo, vIdx) => ({
      id: `${masterId}-var${vIdx}`,
      variantName: combo.map((c) => c.value).join(' × '),
      variantCode: `${masterId}-${vIdx}`,
      isDefault: false,
      status: 'active',
      displayOrder: vIdx,
      optionCombination: combo,
      basePrice: 19000 + vIdx * 100,
      membershipPrice: 17000 + vIdx * 100,
      tieredPrices: [],
    })),
  } as unknown as PimProductSnapshot;
}

// ---------------------------------------------------------------- cpu sampling

/** taskset 로 호스트에 띄운 프로덕션 서버 프로세스를 찾는다 (build/CLI 프로세스 제외) */
function findMedusaPid(): number | null {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (cmdline.includes('.medusa/server') && cmdline.includes('node')) return Number(entry);
    } catch {
      /* 프로세스가 사라짐 — 무시 */
    }
  }
  return null;
}

/**
 * 프로세스가 소비한 누적 CPU 초 (utime + stime).
 * /proc/<pid>/stat 의 comm 필드에 공백이 들어갈 수 있어 마지막 ')' 이후부터 파싱한다.
 * 잘라낸 배열의 index 0 = stat 3번째 필드(state) → utime(14번째)=index 11, stime(15번째)=index 12.
 */
function cpuSeconds(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return (utime + stime) / 100; // USER_HZ = 100
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- runner

interface ArmResult {
  arm: string;
  bucket: BucketName;
  products: number;
  variantsPerProduct: number;
  wallSeconds: number;
  productsPerMin: number;
  cpuSeconds: number | null;
  callCount: number;
  p50Ms: number;
  p95Ms: number;
  failures: number;
  failureSample?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

async function withPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      await fn(items[cursor++]);
    }
  });
  await Promise.all(workers);
}

async function measure(
  arm: string,
  bucket: BucketName,
  productCount: number,
  variantsPerProduct: number,
  pid: number | null,
  run: (latencies: number[], failures: { count: number; sample?: string }) => Promise<void>,
): Promise<ArmResult> {
  const latencies: number[] = [];
  const failures = { count: 0, sample: undefined as string | undefined };

  const cpuBefore = pid ? cpuSeconds(pid) : null;
  const t0 = performance.now();
  await run(latencies, failures);
  const wallSeconds = (performance.now() - t0) / 1000;
  const cpuAfter = pid ? cpuSeconds(pid) : null;

  latencies.sort((a, b) => a - b);
  return {
    arm,
    bucket,
    products: productCount,
    variantsPerProduct,
    wallSeconds: Number(wallSeconds.toFixed(3)),
    productsPerMin: Number(((productCount / wallSeconds) * 60).toFixed(1)),
    cpuSeconds: cpuBefore !== null && cpuAfter !== null ? Number((cpuAfter - cpuBefore).toFixed(2)) : null,
    callCount: latencies.length,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    failures: failures.count,
    failureSample: failures.sample,
  };
}

// ---------------------------------------------------------------- main

/**
 * 프로덕션 MedusaClient 는 `sk_*` 시크릿 키(`apiKey`)로 인증한다. 측정도 같은 경로를 타야
 * 인증 오버헤드가 같으므로, 로그인용 클라이언트로 키를 발급한 뒤 그 키로 측정 클라이언트를 만든다.
 * (Node 에는 localStorage 가 없어 SDK 기본 저장방식으로는 로그인 토큰이 유실된다 → memory 지정)
 */
async function createMeasurementSdk(): Promise<Medusa> {
  const bootstrap = new Medusa({
    baseUrl: MEDUSA_URL,
    auth: { type: 'jwt', jwtTokenStorageMethod: 'memory' },
    debug: false,
  });

  await bootstrap.auth.login('user', 'emailpass', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  console.log('[bench] admin 로그인 완료');

  const { api_key } = await bootstrap.admin.apiKey.create({
    title: `bench-${RUN_ID}`,
    type: 'secret',
  });
  const token = api_key?.token;
  if (!token) throw new Error('시크릿 API 키 발급 실패 — token 이 응답에 없다');
  console.log(`[bench] 시크릿 API 키 발급: ${api_key.id} (프로덕션과 같은 apiKey 인증으로 측정)`);

  return new Medusa({ baseUrl: MEDUSA_URL, apiKey: token, debug: false });
}

async function main() {
  // transformPimToMedusa 가 상품마다 Nest 로그를 찍는다 — 수백 건이면 출력이 묻힌다
  Logger.overrideLogger(false);

  console.log(`[bench] run=${RUN_ID} url=${MEDUSA_URL} n=${N} buckets=${BUCKETS.join(',')} chunks=${CHUNKS.join(',')}`);

  const sdk = await createMeasurementSdk();

  const { sales_channels } = await sdk.admin.salesChannel.list({ limit: 1 });
  const { shipping_profiles } = await sdk.admin.shippingProfile.list({ limit: 1 });
  const salesChannelId = sales_channels?.[0]?.id;
  const shippingProfileId = shipping_profiles?.[0]?.id;
  if (!salesChannelId) throw new Error('판매채널 없음 — seed.ts 를 먼저 실행하라');
  if (!shippingProfileId) throw new Error('배송프로필 없음 — seed-shipping.ts 를 먼저 실행하라');
  console.log(`[bench] salesChannel=${salesChannelId} shippingProfile=${shippingProfileId}`);

  const pid = findMedusaPid();
  console.log(pid ? `[bench] medusa pid=${pid} — CPU 샘플링 켬` : '[bench] medusa pid 못 찾음 — CPU 측정 생략');

  const results: ArmResult[] = [];

  for (const bucketName of BUCKETS) {
    const spec = BUCKET_SPECS[bucketName];
    const variantsPer = combinations(spec.axes).length;

    // arm 마다 handle(=masterId) 이 겹치지 않도록 인덱스 공간을 분리한다
    const build = (offset: number) =>
      Array.from({ length: N }, (_, i) => makeSnapshot(spec, offset + i)).map((snapshot) =>
        transformPimToMedusa(snapshot, {
          categories: [],
          tags: [],
          shipping_profile_id: shippingProfileId,
          sales_channels: [salesChannelId],
        }),
      );

    console.log(`\n=== 버킷 ${bucketName} (${spec.label}) ===`);

    // --- Arm A: 단건 create, 동시성 = live 워커 설정
    const singlePayloads = build(0);
    const single = await measure('single', bucketName, N, variantsPer, pid, async (lat, fail) => {
      await withPool(singlePayloads, SINGLE_CONCURRENCY, async (payload) => {
        const t = performance.now();
        try {
          await sdk.admin.product.create(payload as never);
        } catch (e) {
          fail.count += 1;
          fail.sample ??= String((e as Error)?.message ?? e).slice(0, 300);
        }
        lat.push(performance.now() - t);
      });
    });
    results.push(single);
    console.log(
      `  single           → ${single.productsPerMin}/min  wall ${single.wallSeconds}s  cpu ${single.cpuSeconds}s  p50 ${single.p50Ms}ms  fail ${single.failures}`,
    );
    if (single.failureSample) console.log(`    실패 예: ${single.failureSample}`);

    // --- Arm B: 배치, 청크 크기별
    for (const [idx, chunk] of CHUNKS.entries()) {
      const batchPayloads = build(10_000 * (idx + 1));
      const groups: unknown[][] = [];
      for (let i = 0; i < batchPayloads.length; i += chunk) groups.push(batchPayloads.slice(i, i + chunk));

      const r = await measure(`batch-${chunk}`, bucketName, N, variantsPer, pid, async (lat, fail) => {
        for (const group of groups) {
          const t = performance.now();
          try {
            await sdk.admin.product.batch({ create: group as never });
          } catch (e) {
            fail.count += group.length;
            fail.sample ??= String((e as Error)?.message ?? e).slice(0, 300);
          }
          lat.push(performance.now() - t);
        }
      });
      results.push(r);
      console.log(
        `  batch-${String(chunk).padEnd(3)}      → ${r.productsPerMin}/min  wall ${r.wallSeconds}s  cpu ${r.cpuSeconds}s  p50 ${r.p50Ms}ms  fail ${r.failures}`,
      );
      if (r.failureSample) console.log(`    실패 예: ${r.failureSample}`);
    }

    // --- Arm C: variant 총량 예산으로 청킹 (상품수 무관)
    if (VARIANT_BUDGET > 0) {
      const perBatch = Math.max(1, Math.floor(VARIANT_BUDGET / variantsPer));
      const budgetPayloads = build(10_000 * (CHUNKS.length + 1));
      const groups: unknown[][] = [];
      for (let i = 0; i < budgetPayloads.length; i += perBatch) groups.push(budgetPayloads.slice(i, i + perBatch));

      const r = await measure(`vbudget-${VARIANT_BUDGET}`, bucketName, N, variantsPer, pid, async (lat, fail) => {
        for (const group of groups) {
          const t = performance.now();
          try {
            await sdk.admin.product.batch({ create: group as never });
          } catch (e) {
            fail.count += group.length;
            fail.sample ??= String((e as Error)?.message ?? e).slice(0, 300);
          }
          lat.push(performance.now() - t);
        }
      });
      results.push(r);
      console.log(
        `  vbudget-${VARIANT_BUDGET} (상품 ${perBatch}개/배치) → ${r.productsPerMin}/min  wall ${r.wallSeconds}s  cpu ${r.cpuSeconds}s  p50 ${r.p50Ms}ms  fail ${r.failures}`,
      );
      if (r.failureSample) console.log(`    실패 예: ${r.failureSample}`);
    }
  }

  // ---------------------------------------------------------------- report
  console.log('\n================ 요약 ================');
  console.log('bucket  arm         prod/min   wall(s)  cpu(s)  p50(ms)  p95(ms)  fail');
  for (const r of results) {
    console.log(
      [
        r.bucket.padEnd(7),
        r.arm.padEnd(11),
        String(r.productsPerMin).padEnd(10),
        String(r.wallSeconds).padEnd(8),
        String(r.cpuSeconds ?? '-').padEnd(7),
        String(r.p50Ms).padEnd(8),
        String(r.p95Ms).padEnd(8),
        r.failures,
      ].join(' '),
    );
  }

  console.log('\n---- single 대비 배수 (판단 기준: 전 버킷 <1.5x 폐기 / >=2x 채택) ----');
  for (const bucket of BUCKETS) {
    const base = results.find((r) => r.bucket === bucket && r.arm === 'single');
    if (!base || base.productsPerMin === 0) continue;
    for (const r of results.filter((x) => x.bucket === bucket && x.arm !== 'single')) {
      console.log(`  ${bucket} ${r.arm.padEnd(11)} ${(r.productsPerMin / base.productsPerMin).toFixed(2)}x`);
    }
  }

  const out = `bench-result-${RUN_ID}.json`;
  writeFileSync(out, JSON.stringify({ runId: RUN_ID, n: N, concurrency: SINGLE_CONCURRENCY, results }, null, 2));
  console.log(`\n결과 저장: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
