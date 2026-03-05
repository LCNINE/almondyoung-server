/** @format */

// src/features/order/hooks/use-table-row-selection.ts
import { useState, useMemo, useCallback } from 'react';

interface UseTableRowSelectionProps<T> {
  rows: T[];
  getRowId: (row: T) => string;
}

interface UseTableRowSelectionReturn {
  selectedRows: Set<string>;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  handleSelectAll: (checked: boolean) => void;
  handleSelectRow: (rowId: string, checked: boolean) => void;
  clearSelection: () => void;
  selectRows: (rowIds: string[]) => void;
  getSelectedRowsData: <T>(rows: T[], getRowId: (row: T) => string) => T[];
}

export function useTableRowSelection<T>({
  rows,
  getRowId,
}: UseTableRowSelectionProps<T>): UseTableRowSelectionReturn {
  // 선택된 행들의 ID를 저장하는 state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // 전체 선택 체크박스 상태 계산
  const isAllSelected = useMemo(
    () => rows.length > 0 && selectedRows.size === rows.length,
    [rows.length, selectedRows.size]
  );

  const isIndeterminate = useMemo(
    () => selectedRows.size > 0 && selectedRows.size < rows.length,
    [selectedRows.size, rows.length]
  );

  // 전체 선택/해제 처리
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        // 모든 행의 ID를 선택
        const allRowIds = new Set(rows.map(getRowId));
        setSelectedRows(allRowIds);
      } else {
        // 모든 선택 해제
        setSelectedRows(new Set());
      }
    },
    [rows, getRowId]
  );

  // 개별 행 선택/해제 처리
  const handleSelectRow = useCallback((rowId: string, checked: boolean) => {
    setSelectedRows((prev) => {
      const newSelectedRows = new Set(prev);
      if (checked) {
        newSelectedRows.add(rowId);
      } else {
        newSelectedRows.delete(rowId);
      }
      return newSelectedRows;
    });
  }, []);

  // 선택 초기화
  const clearSelection = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  // 특정 행들 선택
  const selectRows = useCallback((rowIds: string[]) => {
    setSelectedRows(new Set(rowIds));
  }, []);

  // 선택된 행들의 데이터 반환
  const getSelectedRowsData = useCallback(
    <T>(rows: T[], getRowId: (row: T) => string): T[] => {
      return rows.filter((row) => selectedRows.has(getRowId(row)));
    },
    [selectedRows]
  );

  return {
    selectedRows,
    isAllSelected,
    isIndeterminate,
    handleSelectAll,
    handleSelectRow,
    clearSelection,
    selectRows,
    getSelectedRowsData,
  };
}
