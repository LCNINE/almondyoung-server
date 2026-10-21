// 토스 가상계좌 응답의 virtualAccount.bankCode(2자리) → 고객에게 보일 은행명.
// admin-web `lib/constants/toss-banks.ts` 와 같은 코드 체계다.
const TOSS_BANK_NAMES: Readonly<Record<string, string>> = {
  '02': '산업은행',
  '03': '기업은행',
  '06': '국민은행',
  '07': '수협은행',
  '11': '농협은행',
  '12': '단위농협',
  '20': '우리은행',
  '23': 'SC제일은행',
  '27': '씨티은행',
  '31': '대구은행',
  '32': '부산은행',
  '34': '광주은행',
  '35': '제주은행',
  '37': '전북은행',
  '39': '경남은행',
  '45': '새마을금고',
  '48': '신협',
  '50': '저축은행',
  '71': '우체국',
  '81': '하나은행',
  '88': '신한은행',
  '89': '케이뱅크',
  '90': '카카오뱅크',
  '92': '토스뱅크',
};

export function tossBankName(bankCode: string): string {
  return TOSS_BANK_NAMES[bankCode] ?? bankCode;
}
