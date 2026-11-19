/**
 * 셀메이트 미발송 주문 내보내기에서 자사몰 주문의 표시번호(displayId)를 뽑는다.
 * 자사몰 주문번호는 `YYYYMMDD-<displayId>` 꼴이다.
 */
import { detectColumns } from '../parse';

const COLUMN_CANDIDATES = {
  channel: ['판매처', '판매처명'],
  orderNo: ['주문번호', '판매처주문번호'],
} as const;

export function parseOwnMallDisplayIds(
  table: string[][],
  ownMallChannel: string,
): { displayIds: number[]; errors: string[] } {
  if (table.length < 1) throw new Error('주문 파일이 비어 있습니다.');
  const header = table[0];
  const cols = detectColumns(header, COLUMN_CANDIDATES, {
    channel: process.env.COL_CHANNEL,
    orderNo: process.env.COL_ORDER_NO,
  });
  if (cols.channel < 0 || cols.orderNo < 0) {
    throw new Error(`주문 파일에서 판매처/주문번호 열을 못 찾았습니다.\n   헤더: ${header.join(' | ')}`);
  }
  const ids = new Set<number>();
  const errors: string[] = [];
  for (let i = 1; i < table.length; i++) {
    if ((table[i][cols.channel] ?? '').toString().trim() !== ownMallChannel) continue;
    const orderNo = (table[i][cols.orderNo] ?? '').toString().trim();
    // 셀메이트 «추가주문생성» 으로 만든 주문은 «셀-» 이 붙고(복사할수록 «셀-셀-» 로 쌓인다) 나누면 끝에 -NN 이 붙는다.
    // 원 주문을 셀메이트가 마저 내보내는 것이므로 원 주문 번호로 읽는다(2026-11-19 라이브 리허설에서 확인, #1251).
    const m = /^(?:(?:셀-)+\d{8}-(\d+)(?:-\d+)?|\d{8}-(\d+))$/.exec(orderNo);
    const id = m ? Number(m[1] ?? m[2]) : NaN;
    if (!Number.isSafeInteger(id)) {
      errors.push(`행${i + 1}: 자사몰 주문번호 "${orderNo}" 가 YYYYMMDD-숫자 꼴이 아닙니다`);
      continue;
    }
    ids.add(id);
  }
  return { displayIds: [...ids], errors };
}
