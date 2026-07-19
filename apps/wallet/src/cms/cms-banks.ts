import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// 효성 CMS 자동이체 지원 금융기관 코드(3자리). wallet-web `lib/cms-banks.ts`(고객 폼 드롭다운)와
// 동일한 집합이어야 한다 — 은행 추가 시 두 곳을 같이 갱신한다. 화이트리스트로 오타성 은행코드(Q101류)를
// API 경계에서 사전 차단한다.
export const CMS_BANK_CODES: ReadonlySet<string> = new Set([
  '002', '003', '004', '007', '011', '020', '023', '027', '031', '032', '034', '035',
  '037', '039', '045', '048', '071', '081', '088', '089', '090', '092',
]);

export function isValidCmsBankCode(value: string): boolean {
  return CMS_BANK_CODES.has(value);
}

@ValidatorConstraint({ name: 'isValidCmsBankCode', async: false })
export class IsValidCmsBankCodeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidCmsBankCode(value);
  }

  defaultMessage(): string {
    return 'paymentCompany must be a supported CMS bank code';
  }
}
