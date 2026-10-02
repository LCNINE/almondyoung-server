import type { SmsGroupRecipientInput } from '@/lib/api/domains/sms-gate';

const PHONE_HEADERS = [
  '전화',
  '휴대',
  '핸드폰',
  '연락처',
  'phone',
  'mobile',
  'tel',
];
const NAME_HEADERS = ['이름', '성명', '고객명', '상호', '업체', '가게', 'name'];

const findColumn = (header: string[], keys: string[]) =>
  header.findIndex((cell) =>
    keys.some((key) => cell.toLowerCase().includes(key))
  );

/** 첫 행을 머리글로 보고 전화번호·이름 열을 찾는다. 번호 형식 검사·중복 제거는 서버가 한다. */
export function toRecipientInputs(rows: unknown[][]): SmsGroupRecipientInput[] {
  const [headerRow, ...body] = rows;
  const header = (headerRow ?? []).map((cell) => String(cell ?? '').trim());
  const phoneIdx = findColumn(header, PHONE_HEADERS);
  if (phoneIdx === -1) {
    throw new Error(
      '첫 행에서 전화번호 열을 찾지 못했습니다. 머리글을 "전화번호" 또는 "휴대폰"으로 적어 주세요.'
    );
  }
  const nameIdx = findColumn(header, NAME_HEADERS);
  return body
    .map((row) => ({
      name:
        nameIdx === -1
          ? undefined
          : String(row[nameIdx] ?? '').trim() || undefined,
      phone: String(row[phoneIdx] ?? '').trim(),
    }))
    .filter((row) => row.phone.length > 0);
}
