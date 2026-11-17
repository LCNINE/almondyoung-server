/** 열 메타 중 표 폭 계산에 쓰는 것(`ColumnMeta` 의 일부). */
interface ColumnWidthMeta {
  readonly width?: number;
  readonly minWidth?: number;
  readonly fluid?: boolean;
}

/**
 * 최소 폭(`minWidth`)을 가진 열이 있으면 표의 최소 폭 = 고정 폭 합 + 최소 폭 합. 없으면 undefined(표 배치 그대로).
 *
 * 셀의 min-width 만으로는 안 된다 — grid 표는 `table-fixed` 라 브라우저가 셀의 min-width 를 무시하고, 표가 컨테이너 폭에 맞춰
 * 폭을 정하지 않은 열을 한 글자 폭까지 누른다(11-08 라이브, 상품명 열). 표에 최소 폭을 걸면 좁은 화면에서 표가 그 폭을 지키며
 * 가로로 스크롤되고, 고정 폭 열을 뺀 나머지를 최소 폭 열이 받는다. 남은 폭을 채우는 열(fluid)은 더하지 않는다.
 */
export function tableMinWidth(metas: readonly (ColumnWidthMeta | undefined)[]): number | undefined {
  if (!metas.some((m) => m?.minWidth)) return undefined;
  return metas.reduce((sum, m) => (m && !m.fluid ? sum + (m.width ?? m.minWidth ?? 0) : sum), 0);
}
