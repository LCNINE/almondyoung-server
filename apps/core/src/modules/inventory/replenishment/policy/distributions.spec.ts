import { gammaQuantile, lnGamma, normalCdf, normalQuantile, regularizedGammaP } from './distributions';

describe('normal', () => {
  it('Φ⁻¹ 표준 표 값', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.9)).toBeCloseTo(1.28155, 4);
    expect(normalQuantile(0.95)).toBeCloseTo(1.64485, 4);
    expect(normalQuantile(0.975)).toBeCloseTo(1.95996, 4);
    expect(normalQuantile(0.98)).toBeCloseTo(2.05375, 4);
    expect(normalQuantile(0.99)).toBeCloseTo(2.32635, 4);
    expect(normalQuantile(0.05)).toBeCloseTo(-1.64485, 4);
  });
  it('Φ 와 역함수가 맞물린다', () => {
    expect(normalCdf(1.95996)).toBeCloseTo(0.975, 5);
    // A&S 7.1.26 근사의 절대오차 상한은 7.5e-8 이다 (계수 합이 0.999999999 로 정확히
    // 1 이 아니라서). 소수 9자리(임계 5e-10) 단언은 근사가 감당할 수 있는 정밀도를
    // 초과 요구해 실측(0.5000000005, 오차 5.0000004e-10)이 임계를 살짝 넘겨 실패한다.
    // x === 0 특수 케이스로 단락시키지 않는다 — 그건 불연속을 만들고 일반 오차를 감춘다.
    expect(normalCdf(0)).toBeCloseTo(0.5, 8);
    expect(normalCdf(normalQuantile(0.8))).toBeCloseTo(0.8, 6);
  });
  it('p 가 (0,1) 밖이면 던진다', () => {
    expect(() => normalQuantile(0)).toThrow();
    expect(() => normalQuantile(1)).toThrow();
  });
});

describe('gamma', () => {
  it('lnΓ: Γ(1)=1 · Γ(5)=24 · Γ(½)=√π', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 9);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 9);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 9);
  });
  it('정규화 불완전감마 P: P(1,x)=1−e^−x · P(½,1)=erf(1)', () => {
    expect(regularizedGammaP(1, 1)).toBeCloseTo(1 - Math.exp(-1), 8);
    expect(regularizedGammaP(1, 3)).toBeCloseTo(1 - Math.exp(-3), 8);
    expect(regularizedGammaP(0.5, 1)).toBeCloseTo(0.8427008, 6);
    expect(regularizedGammaP(5, 0)).toBe(0);
  });

  // Γ(k, θ=2) = χ²(2k). 카이제곱 임계표(df = 1 · 2 · 4 · 10 · 40, p = 0.90 · 0.95 · 0.99).
  const CHI2: Array<[df: number, p: number, value: number]> = [
    [1, 0.9, 2.7055],
    [1, 0.95, 3.8415],
    [1, 0.99, 6.6349],
    [2, 0.9, 4.6052],
    [2, 0.95, 5.9915],
    [2, 0.99, 9.2103],
    [4, 0.9, 7.7794],
    [4, 0.95, 9.4877],
    [4, 0.99, 13.2767],
    [10, 0.9, 15.9872],
    [10, 0.95, 18.307],
    [10, 0.99, 23.2093],
    [40, 0.9, 51.8051],
    [40, 0.95, 55.7585],
    [40, 0.99, 63.6907],
  ];
  it.each(CHI2)('χ²(df=%i, p=%f) = %f', (df, p, value) => {
    expect(gammaQuantile(p, df / 2, 2)).toBeCloseTo(value, 2);
  });
  it('χ²(2, p) = −2·ln(1−p) 닫힌 식과 일치', () => {
    for (const p of [0.5, 0.8, 0.9, 0.95, 0.98, 0.99, 0.999]) {
      expect(gammaQuantile(p, 1, 2)).toBeCloseTo(-2 * Math.log(1 - p), 6);
    }
  });
  it('척도는 선형이다', () => {
    expect(gammaQuantile(0.95, 1, 10)).toBeCloseTo(10 * -Math.log(0.05), 6);
  });
  it('CV → 0 이면 정규로 수렴한다 — μ 100 · σ 5 (k = 400) 의 95% 분위수는 100 + 1.645·5 근처', () => {
    const mu = 100;
    const sigma = 5;
    const shape = (mu * mu) / (sigma * sigma);
    const scale = (sigma * sigma) / mu;
    expect(gammaQuantile(0.95, shape, scale)).toBeCloseTo(mu + 1.64485 * sigma, 0);
  });
  it('shape · scale 이 0 이하거나 p 가 (0,1) 밖이면 던진다', () => {
    expect(() => gammaQuantile(0.95, 0, 1)).toThrow();
    expect(() => gammaQuantile(0.95, 1, 0)).toThrow();
    expect(() => gammaQuantile(1, 1, 1)).toThrow();
  });
});
