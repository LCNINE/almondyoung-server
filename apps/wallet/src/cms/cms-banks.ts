import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// 효성 CMS 자동이체 지원 금융기관 코드(3자리). wallet-web `lib/cms-banks.ts`(고객 폼 드롭다운)와
// 동일한 집합이어야 한다 — 은행 추가 시 두 곳을 같이 갱신한다. 화이트리스트로 오타성 은행코드(Q101류)를
// API 경계에서 사전 차단한다.
const CMS_BANK_NAMES: Readonly<Record<string, string>> = {
  '002': '산업은행',
  '003': '기업은행',
  '004': '국민은행',
  '007': '수협은행',
  '011': '농협은행',
  '020': '우리은행',
  '023': 'SC제일은행',
  '027': '한국씨티은행',
  '031': '대구은행',
  '032': '부산은행',
  '034': '광주은행',
  '035': '제주은행',
  '037': '전북은행',
  '039': '경남은행',
  '045': '새마을금고',
  '048': '신협',
  '071': '우체국',
  '081': '하나은행',
  '088': '신한은행',
  '089': '케이뱅크',
  '090': '카카오뱅크',
  '092': '토스뱅크',
};

export const CMS_BANK_CODES: ReadonlySet<string> = new Set(Object.keys(CMS_BANK_NAMES));

/** 고객에게 보여줄 은행 이름. 모르는 코드면 코드를 그대로 돌려준다. */
export function getCmsBankName(code: string): string {
  return CMS_BANK_NAMES[code] ?? code;
}

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
