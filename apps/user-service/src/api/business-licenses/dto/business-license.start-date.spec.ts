import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateBusinessLicenseDto,
  FillBusinessNumberDto,
  IsBusinessNumberChecksumConstraint,
  IsRealStartDateConstraint,
  UpdateBusinessLicenseDto,
} from './business-license.dto';

describe('IsRealStartDateConstraint', () => {
  const constraint = new IsRealStartDateConstraint();
  const yyyymmdd = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

  it.each(['20200315', '19850203', '20240229'])('실제 과거 날짜 %s 는 통과한다', (value) => {
    expect(constraint.validate(value)).toBe(true);
  });

  // live 심사중 적체(2026-08-24)에서 실제로 발견된 입력값들
  it.each([
    ['20218326', '83월'],
    ['10151104', '1015년'],
    ['20230229', '윤년 아닌 2월 29일'],
    ['2024031', '8자리 미만'],
    ['', '빈 값'],
  ])('%s (%s) 는 거부한다', (value) => {
    expect(constraint.validate(value)).toBe(false);
  });

  it('미래 날짜는 거부한다', () => {
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(constraint.validate(yyyymmdd(nextMonth))).toBe(false);
  });

  it('오늘 개업은 통과한다 (KST-UTC 9시간 차이로 미래로 보이면 안 된다)', () => {
    expect(constraint.validate(yyyymmdd(new Date()))).toBe(true);
  });
});

describe('DTO 배선 — startDate 검증이 실제로 걸려 있는가', () => {
  const validateDto = async (cls: new () => object, payload: Record<string, unknown>) => {
    const dto = plainToInstance(cls, payload);
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.keys(e.constraints ?? {}).map(() => e.property));
  };

  it.each([
    ['CreateBusinessLicenseDto', CreateBusinessLicenseDto],
    ['UpdateBusinessLicenseDto', UpdateBusinessLicenseDto],
  ])('%s — 직접입력 경로에서 달력에 없는 개업일자를 거부한다', async (_name, cls) => {
    const failed = await validateDto(cls as new () => object, {
      businessNumber: '1308673924',
      representativeName: '홍길동',
      startDate: '20218326',
    });
    expect(failed).toContain('startDate');
  });

  it.each([
    ['CreateBusinessLicenseDto', CreateBusinessLicenseDto],
    ['UpdateBusinessLicenseDto', UpdateBusinessLicenseDto],
  ])('%s — 정상 개업일자는 통과한다', async (_name, cls) => {
    const failed = await validateDto(cls as new () => object, {
      businessNumber: '1308673924',
      representativeName: '홍길동',
      startDate: '20200315',
    });
    expect(failed).toEqual([]);
  });

  // 파일첨부 경로는 번호·대표자명·개업일자를 받지 않는다 — 새 검증이 이 경로를 막으면 안 된다.
  it('파일첨부 경로는 startDate 없이도 통과한다', async () => {
    const failed = await validateDto(CreateBusinessLicenseDto, {
      fileUrl: 'https://example.com/a.jpg',
    });
    expect(failed).toEqual([]);
  });
});

describe('IsBusinessNumberChecksumConstraint', () => {
  const constraint = new IsBusinessNumberChecksumConstraint();

  // 라이브 승인 레코드에서 가져온 실제 사업자번호들
  it.each(['1308673924', '1064811210'])('실존 번호 %s 는 통과한다', (value) => {
    expect(constraint.validate(value)).toBe(true);
  });

  // 전부 국세청 조회에서 "등록되지 않은 번호" 로 확인된 값들 (2026-08-25)
  it.each(['1234567890', '8800502946', '1381701825', '3511003235', '4712901800', '3695300992'])(
    '계산상 불가능한 번호 %s 는 거부한다',
    (value) => {
      expect(constraint.validate(value)).toBe(false);
    },
  );

  it.each(['130867392', '13086739241', '13086739ab', ''])('형식이 틀린 %s 는 거부한다', (value) => {
    expect(constraint.validate(value)).toBe(false);
  });

  // 서류로 승인된 뒤 번호만 채우는 경로가 10자리만 봐서 가짜 번호가 승인 레코드에 실렸다.
  it('FillBusinessNumberDto 에도 체크섬이 걸려 있다', async () => {
    const dto = plainToInstance(FillBusinessNumberDto, { businessNumber: '1234567890' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('businessNumber');
  });

  it.each([
    ['CreateBusinessLicenseDto', CreateBusinessLicenseDto],
    ['UpdateBusinessLicenseDto', UpdateBusinessLicenseDto],
  ])('%s — 직접입력 경로에서 불가능한 번호를 거부한다', async (_name, cls) => {
    const dto = plainToInstance(cls as new () => object, {
      businessNumber: '1234567890',
      representativeName: '홍길동',
      startDate: '20200315',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('businessNumber');
  });
});
