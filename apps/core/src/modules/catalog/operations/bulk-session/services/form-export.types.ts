/**
 * 워크북 한 행. 키는 ColumnDef.key 이고 값은 **항상 문자열**이다.
 * 숫자·날짜를 셀에 그대로 넣으면 exceljs 가 로케일·TZ 의존 서식으로 되돌려주므로
 * (cell.text 가 Date.prototype.toString() 이다) 조립 단계에서 규격 문자열로 굳힌다.
 */
export type PrefillCell = string;

export type PrefillRow = Record<string, PrefillCell>;

export interface PrefillWorkbookData {
  exportId: string;
  products: PrefillRow[];
  options: PrefillRow[];
  variants: PrefillRow[];
  categories: PrefillRow[];
  constraints: PrefillRow[];
  images: PrefillRow[];
  /** 카테고리 참조 시트용. '여성패션>니트' 형태의 전체 경로 목록. */
  categoryPaths: string[];
}
