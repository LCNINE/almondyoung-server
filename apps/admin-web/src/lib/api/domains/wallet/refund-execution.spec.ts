import { refundExecutionLabel } from './refund-execution';

describe('refundExecutionLabel', () => {
  it('수동 실행은 «계좌 송금», 자동·모름은 빈 칸(정상 상태는 숨긴다)', () => {
    expect(refundExecutionLabel('MANUAL')).toBe('계좌 송금');
    expect(refundExecutionLabel('AUTO')).toBe('');
    expect(refundExecutionLabel(undefined)).toBe('');
  });
});
