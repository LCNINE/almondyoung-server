export const CMS_BANKS = [
  { code: '002', name: '산업은행', digits: [11, 14] },
  { code: '003', name: '기업은행', digits: [11, 14] },
  { code: '004', name: '국민은행', digits: [11, 14] },
  { code: '007', name: '수협은행', digits: [11, 14] },
  { code: '011', name: '농협은행', digits: [11, 14] },
  { code: '020', name: '우리은행', digits: [11, 14] },
  { code: '023', name: 'SC제일은행', digits: [11, 14] },
  { code: '027', name: '한국씨티은행', digits: [10, 14] },
  { code: '031', name: '대구은행', digits: [11, 14] },
  { code: '032', name: '부산은행', digits: [11, 14] },
  { code: '034', name: '광주은행', digits: [11, 14] },
  { code: '035', name: '제주은행', digits: [11, 14] },
  { code: '037', name: '전북은행', digits: [11, 14] },
  { code: '039', name: '경남은행', digits: [11, 14] },
  { code: '045', name: '새마을금고', digits: [13, 13] },
  { code: '048', name: '신협', digits: [11, 14] },
  { code: '071', name: '우체국', digits: [11, 14] },
  { code: '081', name: '하나은행', digits: [11, 14] },
  { code: '088', name: '신한은행', digits: [11, 13] },
  { code: '089', name: '케이뱅크', digits: [12, 12] },
  { code: '090', name: '카카오뱅크', digits: [13, 13] },
  { code: '092', name: '토스뱅크', digits: [12, 12] },
] as const;

export function getBankName(code: string): string {
  return CMS_BANKS.find((b) => b.code === code)?.name ?? code;
}

export function getAccountDigits(code: string): { min: number; max: number } {
  const digits = CMS_BANKS.find((b) => b.code === code)?.digits;
  return { min: digits?.[0] ?? 11, max: digits?.[1] ?? 14 };
}

export function formatAccountDigits(code: string): string {
  const { min, max } = getAccountDigits(code);
  return min === max ? `${min}자리` : `${min}~${max}자리`;
}
