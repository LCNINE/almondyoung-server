import type { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // 원본 ColumnMeta 제네릭 시그니처와 일치해야 병합된다.
  interface ColumnMeta<TData extends RowData, TValue> {
    /** 셀 아무 곳이나 클릭하면 행 선택을 토글하고, 행 네비게이션은 차단한다. */
    clickTogglesRowSelection?: boolean;
    /** 고정 열폭(px). 미지정 열이 남은 폭을 나눠 가진다. */
    width?: number;
    /** 남은 폭을 채우고, 넘치는 글은 셀 안 truncate 로 자른다 (표를 가로로 밀어내지 않는다). */
    fluid?: boolean;
    align?: 'left' | 'center' | 'right';
  }
}
