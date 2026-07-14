import { classifyDriftSeverity } from './ledger-reconciliation.service';

describe('classifyDriftSeverity', () => {
  it('파생 수량이 음수면 CRITICAL (이벤트 원장 구조 위반)', () => {
    expect(classifyDriftSeverity(-1)).toBe('CRITICAL');
  });
  it('파생 수량이 0 이상이면 MISMATCH', () => {
    expect(classifyDriftSeverity(0)).toBe('MISMATCH');
    expect(classifyDriftSeverity(5)).toBe('MISMATCH');
  });
});
