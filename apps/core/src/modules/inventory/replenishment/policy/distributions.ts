/**
 * 정규 · 감마 분포의 CDF 와 분위수 (스펙 §5.1). 외부 라이브러리 없이, 순수 함수 — Nest · drizzle 을 모른다.
 *
 * - Φ: Abramowitz–Stegun 7.1.26 erf 근사(|ε| < 1.5e-7). 분위수는 이분법.
 * - lnΓ: Lanczos(g=7, n=9). P(k, x): 급수(x < k+1) / 연분수(그 외) — Numerical Recipes gser · gcf.
 * - 감마 분위수: P(k, x/θ) 를 이분법으로 역산. 상한은 평균 + 10σ 에서 시작해 부족하면 두 배씩.
 */
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function assertProbability(p: number): void {
  if (!(p > 0 && p < 1)) throw new Error(`확률은 (0, 1) 안이어야 한다: ${p}`);
}

/** 단조 f 에서 f(x) = target 인 x 를 [lo, hi] 이분법으로. 최대 200 회, 상대오차 1e-12 에서 조기 종료. */
function bisect(f: (x: number) => number, target: number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) break;
  }
  return (lo + hi) / 2;
}

export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + (x < 0 ? -erf : erf));
}

export function normalQuantile(p: number): number {
  assertProbability(p);
  return bisect(normalCdf, p, -40, 40);
}

export function lnGamma(x: number): number {
  if (!(x > 0)) throw new Error(`lnGamma 는 양수만: ${x}`);
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0];
  const t = y + 7.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (y + i);
  return Math.log(SQRT_2PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 정규화 하부 불완전감마 P(k, x) = γ(k, x) / Γ(k). */
export function regularizedGammaP(shape: number, x: number): number {
  if (!(shape > 0)) throw new Error(`shape 는 양수만: ${shape}`);
  if (x <= 0) return 0;
  const logPrefix = -x + shape * Math.log(x) - lnGamma(shape);
  if (x < shape + 1) {
    let ap = shape;
    let sum = 1 / shape;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(logPrefix));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - shape;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(logPrefix) * h);
}

export function gammaQuantile(p: number, shape: number, scale: number): number {
  assertProbability(p);
  if (!(shape > 0) || !(scale > 0)) throw new Error(`shape · scale 은 양수만: ${shape}, ${scale}`);
  const mean = shape * scale;
  const std = Math.sqrt(shape) * scale;
  let hi = mean + 10 * std;
  while (regularizedGammaP(shape, hi / scale) < p) hi *= 2;
  return bisect((x) => regularizedGammaP(shape, x / scale), p, 0, hi);
}
