import {
  REPLENISHMENT_SETTINGS_SEED,
  REPLENISHMENT_GRADE_RULE_SEEDS,
  ReplenishmentSeedStep,
} from './replenishment.seed-step';

describe('ReplenishmentSeedStep', () => {
  it('전역 설정 시드는 key=default 한 행이고 스펙 §6 의 보수적 초기값을 갖는다', () => {
    expect(REPLENISHMENT_SETTINGS_SEED.key).toBe('default');
    expect(REPLENISHMENT_SETTINGS_SEED.defaultLeadTimeDays).toBe(30);
    expect(REPLENISHMENT_SETTINGS_SEED.defaultTransferLeadTimeDays).toBe(14);
    expect(REPLENISHMENT_SETTINGS_SEED.defaultCoverDays).toBe(30);
    expect(REPLENISHMENT_SETTINGS_SEED.defaultTransferCoverDays).toBe(14);
    expect(REPLENISHMENT_SETTINGS_SEED.demandCoreSince).toBeNull();
  });

  it('등급 규칙 시드는 A 0.02 · B 0.05 · C 0.10 (스펙 §6 초기값)', () => {
    expect(REPLENISHMENT_GRADE_RULE_SEEDS).toEqual([
      { grade: 'A', alpha: 0.02 },
      { grade: 'B', alpha: 0.05 },
      { grade: 'C', alpha: 0.1 },
    ]);
  });

  it('baseline 그룹이다 — db:seed:ref 가 돌린다', () => {
    const step = new ReplenishmentSeedStep('postgres://localhost:5432/unused');
    expect(step.groups).toEqual(['baseline']);
  });
});
