import {
  businessTypeTarget,
  deriveAutoReviewRows,
  formatBusinessNumber,
} from './ai-review-rows';

const pass = { kind: 'pass' };
const skip = { kind: 'skip' };
const fail = (label: string) => ({ kind: 'fail', label });

describe('deriveAutoReviewRows', () => {
  it('자동 승인이면 모든 행이 맞음이다', () => {
    expect(deriveAutoReviewRows({ decision: 'approve', dryRun: false })).toEqual({
      documentType: pass,
      representative: pass,
      businessNumber: pass,
      startDate: pass,
      businessType: pass,
      nts: pass,
    });
  });

  it('판정만 기록한 자동 승인이면 번호 중복은 확인하지 않았다', () => {
    expect(deriveAutoReviewRows({ decision: 'approve', dryRun: true })).toEqual({
      documentType: pass,
      representative: pass,
      businessNumber: skip,
      startDate: pass,
      businessType: pass,
      nts: pass,
    });
  });

  it('등록증이 아니면 서류 종류만 다름이고 나머지는 확인하지 않았다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'not_license' })
    ).toEqual({
      documentType: fail('다름'),
      representative: skip,
      businessNumber: skip,
      startDate: skip,
      businessType: skip,
      nts: skip,
    });
  });

  it('글자를 못 읽었으면 서류 종류만 맞음이다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'unreadable' })
    ).toEqual({
      documentType: pass,
      representative: skip,
      businessNumber: skip,
      startDate: skip,
      businessType: skip,
      nts: skip,
    });
  });

  it('법인이면 사업자 구분이 다름이다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'corporation' })
    ).toEqual({
      documentType: pass,
      representative: skip,
      businessNumber: skip,
      startDate: skip,
      businessType: fail('다름'),
      nts: skip,
    });
  });

  it('대표자 이름이 다르면 국세청 조회 전에 멈춘다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'name_mismatch' })
    ).toEqual({
      documentType: pass,
      representative: fail('다름'),
      businessNumber: skip,
      startDate: skip,
      businessType: pass,
      nts: skip,
    });
  });

  it('국세청 진위확인이 틀리면 국세청 행이 불일치다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'nts_mismatch' })
    ).toEqual({
      documentType: pass,
      representative: pass,
      businessNumber: skip,
      startDate: skip,
      businessType: pass,
      nts: fail('불일치'),
    });
  });

  it('계속사업자가 아니면 개업일자는 맞고 국세청 행이 불일치다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'not_active' })
    ).toEqual({
      documentType: pass,
      representative: pass,
      businessNumber: skip,
      startDate: pass,
      businessType: pass,
      nts: fail('불일치'),
    });
  });

  it('번호가 중복이면 국세청까지 통과하고 번호 행이 중복이다', () => {
    expect(
      deriveAutoReviewRows({ decision: 'manual', dryRun: false, reason: 'duplicate_number' })
    ).toEqual({
      documentType: pass,
      representative: pass,
      businessNumber: fail('중복'),
      startDate: pass,
      businessType: pass,
      nts: pass,
    });
  });

  it('재시도 대기면 국세청 조회 전 단계까지만 맞음이다', () => {
    expect(deriveAutoReviewRows({ decision: 'retry', dryRun: false })).toEqual({
      documentType: pass,
      representative: pass,
      businessNumber: skip,
      startDate: skip,
      businessType: pass,
      nts: skip,
    });
  });

  it('이미지를 못 열었으면 아무 행도 확인하지 않았다', () => {
    const rows = deriveAutoReviewRows({
      decision: 'manual',
      dryRun: false,
      reason: 'image_unavailable',
    });

    expect(Object.values(rows).every((row) => row.kind === 'skip')).toBe(true);
  });
});

describe('formatBusinessNumber', () => {
  it('숫자 10자리를 ###-##-##### 로 나눈다', () => {
    expect(formatBusinessNumber('1234567890')).toBe('123-45-67890');
  });

  it('비었거나 자릿수가 다르면 받은 그대로 보여 준다', () => {
    expect(formatBusinessNumber(null)).toBe('-');
    expect(formatBusinessNumber('12345')).toBe('12345');
  });
});

describe('businessTypeTarget', () => {
  const reading = {
    isBusinessRegistration: true,
    businessNumber: '1238100000',
    representativeName: '홍길동',
    startDate: '20200101',
    readable: true,
  };

  it('등록증엔 개인으로 읽혔는데 법인으로 멈췄으면 번호로 판단한 것이다', () => {
    expect(
      businessTypeTarget({
        decision: 'manual',
        reason: 'corporation',
        reading: { ...reading, isCorporation: false },
      })
    ).toBe('번호 기준 법인');
  });

  it('등록증에서 법인으로 읽었으면 대조 대상은 개인이다', () => {
    expect(
      businessTypeTarget({
        decision: 'manual',
        reason: 'corporation',
        reading: { ...reading, isCorporation: true },
      })
    ).toBe('개인');
  });

  it('법인 사유가 아니면 대조 대상은 개인이다', () => {
    expect(
      businessTypeTarget({
        decision: 'approve',
        reading: { ...reading, isCorporation: false },
      })
    ).toBe('개인');
  });
});
