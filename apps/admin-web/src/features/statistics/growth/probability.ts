/**
 * 목표 달성 확률 — «지금까지의 하루하루가 앞으로도 비슷하게 반복된다면, 연말에 목표를 넘을 확률».
 *
 * 최근 일매출을 7일 블록으로 잘라(요일 패턴·주 단위 흐름 보존) 남은 날만큼 무작위로 이어 붙이는
 * 블록 부트스트랩을 수천 번 돌린다. 날짜를 하나씩 뽑는(i.i.d.) 방식보다 요일 편차를 덜 뭉갠다.
 * 전제는 «최근 분포가 앞으로도 유지된다»이고, 계절성·행사는 반영하지 않는다 — 화면에 그렇게 쓴다.
 * 남은 날이 관측한 날보다 길면 신뢰가 낮다고 표시한다. 시드를 고정해 같은 입력이면 같은 숫자를 낸다.
 */

export interface ProbabilityInput {
  /** 최근 완료일 일별 달성액(오래된 것 → 최근) */
  recentDaily: number[];
  actualToDate: number;
  annualTarget: number;
  remainingDays: number;
  simulations?: number;
  seed?: number;
}

export interface ProbabilityResult {
  probability: number;
  /** 시뮬레이션 연말 착지 분위수 */
  p10: number;
  p50: number;
  p90: number;
  blocksUsed: number;
  lowConfidence: boolean;
}

const BLOCK = 7;
const MIN_BLOCKS = 4;
const DEFAULT_SIMULATIONS = 4000;

/** mulberry32 — 작고 빠른 시드 고정 난수. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 블록이 4개(28일) 미만이면 null — 분포를 말할 근거가 없다. */
export function goalProbability(input: ProbabilityInput): ProbabilityResult | null {
  const usable = input.recentDaily.length - (input.recentDaily.length % BLOCK);
  const tail = input.recentDaily.slice(input.recentDaily.length - usable);
  const blocks: number[][] = [];
  for (let i = 0; i < tail.length; i += BLOCK) blocks.push(tail.slice(i, i + BLOCK));
  if (blocks.length < MIN_BLOCKS) return null;

  if (input.remainingDays <= 0) {
    const done = input.actualToDate >= input.annualTarget ? 1 : 0;
    return { probability: done, p10: input.actualToDate, p50: input.actualToDate, p90: input.actualToDate, blocksUsed: blocks.length, lowConfidence: false };
  }

  const random = seededRandom(input.seed ?? 20261001);
  const n = input.simulations ?? DEFAULT_SIMULATIONS;
  const landings: number[] = [];
  let hits = 0;
  for (let s = 0; s < n; s += 1) {
    let sum = 0;
    let days = 0;
    while (days < input.remainingDays) {
      const block = blocks[Math.floor(random() * blocks.length)];
      for (let d = 0; d < block.length && days < input.remainingDays; d += 1) {
        sum += block[d];
        days += 1;
      }
    }
    const landing = input.actualToDate + sum;
    landings.push(landing);
    if (landing >= input.annualTarget) hits += 1;
  }
  landings.sort((a, b) => a - b);
  return {
    probability: hits / n,
    p10: quantile(landings, 0.1),
    p50: quantile(landings, 0.5),
    p90: quantile(landings, 0.9),
    blocksUsed: blocks.length,
    lowConfidence: input.remainingDays > blocks.length * BLOCK,
  };
}

/** 모의 실험은 «확실하다»를 말할 수 없다 — 양 끝은 «99% 이상»·«1% 미만»으로 쓴다. */
export function formatProbability(p: number): string {
  if (p >= 0.995) return '99% 이상';
  if (p <= 0.005) return '1% 미만';
  return `${Math.round(p * 100)}%`;
}
