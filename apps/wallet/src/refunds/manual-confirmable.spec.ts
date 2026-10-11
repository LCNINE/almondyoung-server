import { isManuallyConfirmable } from './manual-confirmable';

describe('isManuallyConfirmable — 운영자의 [송금 완료]를 받을 수 있는 환불 행인가', () => {
  it.each([
    ['PENDING · MANUAL · 카드', { status: 'PENDING', execution: 'MANUAL', methodType: 'TOSS' }, true],
    ['PENDING · MANUAL · 효성 CMS', { status: 'PENDING', execution: 'MANUAL', methodType: 'CMS_BATCH' }, true],
    [
      'PENDING · AUTO · 무통장 (지금과 같다)',
      { status: 'PENDING', execution: 'AUTO', methodType: 'BANK_TRANSFER' },
      true,
    ],
    ['PENDING · AUTO · 카드 (PG 가 처리 중)', { status: 'PENDING', execution: 'AUTO', methodType: 'TOSS' }, false],
    ['PENDING · AUTO · 결제수단 모름', { status: 'PENDING', execution: 'AUTO', methodType: null }, false],
    ['SUCCEEDED · MANUAL', { status: 'SUCCEEDED', execution: 'MANUAL', methodType: 'TOSS' }, false],
    ['FAILED · AUTO · 무통장', { status: 'FAILED', execution: 'AUTO', methodType: 'BANK_TRANSFER' }, false],
  ] as const)('%s → %s', (_label, row, expected) => {
    expect(isManuallyConfirmable(row)).toBe(expected);
  });
});
