import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

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

// 은행별 계좌번호 자릿수(하이픈 제외). 자릿수가 고정인 인터넷은행만 좁게 잡고, 상품별로
// 갈리는 시중·지방은행은 넓게 둔다 — 좁히면 멀쩡한 계좌가 API 경계에서 막힌다.
// wallet-web `lib/cms-banks.ts` 의 digits 와 같은 값이어야 한다.
const CMS_BANK_ACCOUNT_DIGITS: Readonly<Record<string, readonly [number, number]>> = {
  '002': [11, 14],
  '003': [11, 14],
  '004': [11, 14],
  '007': [11, 14],
  '011': [11, 14],
  '020': [11, 14],
  '023': [11, 14],
  '027': [10, 14],
  '031': [11, 14],
  '032': [11, 14],
  '034': [11, 14],
  '035': [11, 14],
  '037': [11, 14],
  '039': [11, 14],
  '045': [13, 13],
  '048': [11, 14],
  '071': [11, 14],
  '081': [11, 14],
  '088': [11, 13],
  '089': [12, 12],
  '090': [13, 13],
  '092': [12, 12],
};

/**
 * 계좌번호 자릿수가 그 은행에 있을 수 있는 값인가. 프론트에서만 막으면 API 를 직접 부르는
 * 쪽이 건당 유료 조회를 그대로 태울 수 있어 서버 경계에도 둔다.
 */
export function isValidCmsAccountLength(bankCode: string, accountNumber: string): boolean {
  const [min, max] = CMS_BANK_ACCOUNT_DIGITS[bankCode] ?? [11, 14];
  return accountNumber.length >= min && accountNumber.length <= max;
}

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

@ValidatorConstraint({ name: 'isValidCmsAccountLength', async: false })
export class IsValidCmsAccountLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const bankCode = (args.object as { paymentCompany?: unknown }).paymentCompany;
    // 은행코드·계좌번호 형식 자체는 각자의 검증이 잡는다. 여기서는 둘의 «조합»만 본다.
    if (typeof value !== 'string' || typeof bankCode !== 'string' || !isValidCmsBankCode(bankCode)) return true;
    return isValidCmsAccountLength(bankCode, value);
  }

  defaultMessage(args: ValidationArguments): string {
    const bankCode = (args.object as { paymentCompany?: unknown }).paymentCompany;
    return `paymentNumber length does not match ${typeof bankCode === 'string' ? getCmsBankName(bankCode) : 'the bank'}`;
  }
}
