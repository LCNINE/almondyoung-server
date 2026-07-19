import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// CMS 자동이체 회원등록의 payerNumber 는 개인 생년월일(YYMMDD 6자리) 또는
// 사업자등록번호(10자리) 다. 효성은 이 값과 계좌 실명대사를 D+1 에 처리하고,
// 불일치 시 Q201 로 실패한다(라이브 최대 실패군). 제출 전에 잡을 수 있는
// 형식 오류(사업자번호 체크섬 불일치·생년월일 범위 초과)를 사전 차단한다.

const BUSINESS_NUMBER_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 국세청 표준 사업자등록번호 체크섬. 오타성 10자리 입력을 차단한다. */
export function isValidBusinessRegistrationNumber(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;

  const digits = value.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * BUSINESS_NUMBER_WEIGHTS[i];
  }
  sum += Math.floor((digits[8] * 5) / 10);

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === digits[9];
}

/**
 * 생년월일 YYMMDD 형식·범위 검증. 세기를 알 수 없어 윤년은 판별하지 못하므로
 * 2월은 29일까지 허용한다. "형식은 맞고 값만 다른" 케이스는 못 잡는다(ADR-0027 §5-2 한계).
 */
export function isValidBirthDateYYMMDD(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;

  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false;
  return true;
}

/** payerNumber(6자리 생년월일 또는 10자리 사업자번호) 형식 검증. */
export function isValidPayerNumber(value: string): boolean {
  if (/^\d{6}$/.test(value)) return isValidBirthDateYYMMDD(value);
  if (/^\d{10}$/.test(value)) return isValidBusinessRegistrationNumber(value);
  return false;
}

@ValidatorConstraint({ name: 'isValidPayerNumber', async: false })
export class IsValidPayerNumberConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidPayerNumber(value);
  }

  defaultMessage(): string {
    return 'payerNumber must be a valid 6-digit birthdate (YYMMDD) or a 10-digit business registration number';
  }
}
