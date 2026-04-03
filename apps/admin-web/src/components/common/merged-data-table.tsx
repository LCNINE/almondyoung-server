/** @format */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils/cn';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import type { TableColumn } from './data-table';

/**
 * MergedDataTable — admin-ui-experimental Table 위에 rowspan 지원을 추가한 공통 컴포넌트
 *
 * - `groupKey`로 연속된 행을 그룹화하여 `merged: true` 컬럼에 rowspan을 적용합니다.
 * - `mergeCheckbox: true`이면 체크박스도 그룹당 1개로 병합됩니다.
 *   이 경우 selectedRowKeys는 groupKey 값(그룹 식별자)을 담습니다.
 * - `mergeCheckbox`가 false/미설정이면 행별 체크박스가 렌더링됩니다.
 *   이 경우 selectedRowKeys는 rowKey 값을 담습니다.
 */
export interface MergedTableColumn<T = unknown> extends TableColumn<T> {
    /** true이면 같은 그룹의 첫 번째 행만 셀을 렌더링하고 rowspan으로 병합합니다. */
    merged?: boolean;
}

type BaseProps<T> = {
    data: T[];
    columns: MergedTableColumn<T>[];
    /** 행을 고유하게 식별하는 키 또는 함수 */
    rowKey: keyof T | ((row: T, index: number) => string);
    /** 연속된 행 중 같은 값을 반환하는 행들을 하나의 그룹으로 묶습니다 */
    groupKey: keyof T | ((row: T) => string);
    className?: string;
    loading?: boolean;
    emptyMessage?: string;
    getRowClassName?: (row: T, globalIndex: number) => string;
};

type WithSelection<T> = BaseProps<T> & {
    selectable: true;
    /**
     * true이면 체크박스가 그룹당 1개로 병합됩니다.
     * selectedRowKeys에는 groupKey 값(그룹 식별자)이 들어갑니다.
     */
    mergeCheckbox?: boolean;
    selectedRowKeys: Set<string>;
    onSelectedRowKeysChange: (keys: Set<string>) => void;
    /**
     * 행(또는 그룹의 첫 번째 행)이 선택 가능한지 여부.
     * false를 반환하면 체크박스가 비활성화됩니다.
     */
    isRowSelectable?: (row: T) => boolean;
    selectedRowClassName?: string;
};

type WithoutSelection<T> = BaseProps<T> & {
    selectable?: false;
    mergeCheckbox?: never;
    selectedRowKeys?: never;
    onSelectedRowKeysChange?: never;
    isRowSelectable?: never;
    selectedRowClassName?: never;
};

export type MergedDataTableProps<T> = WithSelection<T> | WithoutSelection<T>;

type RowMeta<T> = {
    row: T;
    rowId: string;
    groupId: string;
    /** > 0이면 그룹의 첫 행(rowspan 값), 0이면 병합 대상(merged 셀 렌더 스킵) */
    span: number;
    globalIndex: number;
};

export function MergedDataTable<T extends Record<string, unknown>>(
    props: MergedDataTableProps<T>,
) {
    const {
        data,
        columns,
        rowKey,
        groupKey,
        className,
        loading = false,
        emptyMessage = '데이터가 없습니다.',
        getRowClassName,
    } = props;

    const {
        selectable,
        mergeCheckbox,
        selectedRowKeys,
        onSelectedRowKeysChange,
        isRowSelectable,
        selectedRowClassName = 'bg-blue-50',
    } = props as WithSelection<T>;

    const [sortConfig, setSortConfig] = useState<{
        key: string;
        direction: 'asc' | 'desc';
    } | null>(null);

    const getRowId = useCallback(
        (row: T, index: number): string => {
            if (typeof rowKey === 'function') return rowKey(row, index);
            return String(row[rowKey as keyof T]);
        },
        [rowKey],
    );

    const getGroupId = useCallback(
        (row: T): string => {
            if (typeof groupKey === 'function') return groupKey(row);
            return String(row[groupKey as keyof T]);
        },
        [groupKey],
    );

    /* ── 정렬 ─────────────────────────────────────────── */
    const sortedData = useMemo(() => {
        if (!sortConfig) return data;
        return [...data].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            if (typeof aVal === 'number' && typeof bVal === 'number')
                return (aVal - bVal) * dir;
            if (typeof aVal === 'string' && typeof bVal === 'string')
                return aVal.localeCompare(bVal) * dir;
            return 0;
        });
    }, [data, sortConfig]);

    /* ── 그룹 메타 계산 ────────────────────────────────── */
    const rows: RowMeta<T>[] = useMemo(() => {
        const result: RowMeta<T>[] = sortedData.map((row, idx) => ({
            row,
            rowId: getRowId(row, idx),
            groupId: getGroupId(row),
            span: 1,
            globalIndex: idx,
        }));

        for (let i = 0; i < result.length; i++) {
            if (result[i].span === 0) continue;
            let span = 1;
            while (
                i + span < result.length &&
                result[i + span].groupId === result[i].groupId
            ) {
                result[i + span].span = 0;
                span++;
            }
            result[i].span = span;
        }
        return result;
    }, [sortedData, getRowId, getGroupId]);

    /* ── 선택 로직 ─────────────────────────────────────── */
    const allSelectableKeys = useMemo<Set<string>>(() => {
        if (!selectable) return new Set();
        if (mergeCheckbox) {
            const firstRows = new Map<string, T>();
            for (const { row, groupId } of rows) {
                if (!firstRows.has(groupId)) firstRows.set(groupId, row);
            }
            const result = new Set<string>();
            firstRows.forEach((row, groupId) => {
                if (!isRowSelectable || isRowSelectable(row)) result.add(groupId);
            });
            return result;
        }
        const result = new Set<string>();
        rows.forEach(({ row, rowId }) => {
            if (!isRowSelectable || isRowSelectable(row)) result.add(rowId);
        });
        return result;
    }, [selectable, mergeCheckbox, rows, isRowSelectable]);

    const isAllSelected =
        selectable &&
        allSelectableKeys.size > 0 &&
        [...allSelectableKeys].every((k) => selectedRowKeys?.has(k));

    const isIndeterminate =
        selectable && !!selectedRowKeys && selectedRowKeys.size > 0 && !isAllSelected;

    const handleSelectAll = (checked: boolean) => {
        if (!selectable) return;
        onSelectedRowKeysChange(checked ? new Set(allSelectableKeys) : new Set());
    };

    const handleToggleRow = (groupId: string, rowId: string, canSelect: boolean) => {
        if (!selectable || !canSelect) return;
        const key = mergeCheckbox ? groupId : rowId;
        const next = new Set(selectedRowKeys ?? []);
        next.has(key) ? next.delete(key) : next.add(key);
        onSelectedRowKeysChange(next);
    };

    const handleSort = (key: string) => {
        setSortConfig((prev) =>
            prev?.key === key && prev.direction === 'asc'
                ? { key, direction: 'desc' }
                : { key, direction: 'asc' },
        );
    };

    /* ── 렌더 ──────────────────────────────────────────── */
    if (loading) {
        return (
            <div className={cn('flex items-center justify-center h-32', className)}>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
        );
    }

    return (
        <div className={className}>
            <Table>
                <Table.Header>
                    <Table.Row>
                        {selectable && (
                            <Table.Head className="w-[40px] text-center">
                                <div className="flex justify-center items-center">
                                    <Checkbox
                                        className="w-4 h-4"
                                        checked={
                                            isAllSelected ? true
                                            : isIndeterminate ? 'indeterminate'
                                            : false
                                        }
                                        onCheckedChange={(v) => handleSelectAll(!!v)}
                                        aria-label="모두 선택"
                                    />
                                </div>
                            </Table.Head>
                        )}
                        {columns.map((col) => (
                            <Table.Head
                                key={col.key}
                                className={cn(
                                    col.align === 'right' ? 'text-right'
                                    : col.align === 'left' ? 'text-left'
                                    : 'text-center',
                                    col.sortable && 'cursor-pointer hover:bg-muted/80',
                                )}
                                style={col.width ? { width: col.width } : undefined}
                                onClick={() => col.sortable && handleSort(col.key)}
                            >
                                <div className="flex items-center justify-center gap-1 whitespace-pre-line">
                                    {col.label}
                                    {col.sortable && sortConfig?.key === col.key &&
                                        (sortConfig.direction === 'asc'
                                            ? <ArrowUp size={12} />
                                            : <ArrowDown size={12} />)}
                                </div>
                            </Table.Head>
                        ))}
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {rows.length === 0 ? (
                        <Table.Row>
                            <Table.Cell
                                colSpan={columns.length + (selectable ? 1 : 0)}
                                className="py-8 text-center text-muted-foreground"
                            >
                                {emptyMessage}
                            </Table.Cell>
                        </Table.Row>
                    ) : (
                        rows.map(({ row, rowId, groupId, span, globalIndex }) => {
                            const isFirst = span > 0;
                            const selKey = mergeCheckbox ? groupId : rowId;
                            const isSelected =
                                selectable && (selectedRowKeys?.has(selKey) ?? false);
                            const canSelect =
                                !isRowSelectable || isRowSelectable(row);
                            const rowClass = getRowClassName?.(row, globalIndex) ?? '';

                            return (
                                <Table.Row
                                    key={rowId}
                                    className={cn(
                                        isSelected && selectedRowClassName,
                                        rowClass,
                                    )}
                                >
                                    {/* 체크박스 셀: mergeCheckbox=true이면 첫 행만(rowspan), 아니면 매 행 */}
                                    {selectable && (mergeCheckbox ? isFirst : true) && (
                                        <td
                                            rowSpan={mergeCheckbox ? span : 1}
                                            className="h-10 px-2 align-middle text-center border-b"
                                        >
                                            <div className="flex justify-center items-center">
                                                <Checkbox
                                                    className="w-4 h-4"
                                                    checked={isSelected}
                                                    disabled={!canSelect}
                                                    onCheckedChange={() =>
                                                        handleToggleRow(groupId, rowId, canSelect)
                                                    }
                                                    aria-label="행 선택"
                                                />
                                            </div>
                                        </td>
                                    )}

                                    {/* 데이터 셀 */}
                                    {columns.map((col) => {
                                        // merged 컬럼은 첫 행만 렌더링 (이후 행은 skip → rowspan으로 커버)
                                        if (col.merged && !isFirst) return null;

                                        const value = row[col.key as keyof T];
                                        const alignClass =
                                            col.align === 'right' ? 'text-right'
                                            : col.align === 'left' ? 'text-left'
                                            : 'text-center';

                                        return (
                                            <td
                                                key={col.key}
                                                rowSpan={col.merged ? span : 1}
                                                className={cn(
                                                    'h-10 px-2 align-top border-b text-sm',
                                                    alignClass,
                                                )}
                                                style={
                                                    col.width
                                                        ? { width: col.width, maxWidth: col.width, wordBreak: 'break-word', whiteSpace: 'normal' }
                                                        : { wordBreak: 'break-word', whiteSpace: 'normal' }
                                                }
                                            >
                                                {col.render
                                                    ? col.render(value as unknown, row as unknown as T, globalIndex)
                                                    : (value as React.ReactNode)}
                                            </td>
                                        );
                                    })}
                                </Table.Row>
                            );
                        })
                    )}
                </Table.Body>
            </Table>
        </div>
    );
}

/** MergedDataTable에서 그룹 기반 선택 상태를 관리하는 헬퍼 훅 */
export function useMergedTableSelection<T extends Record<string, unknown>>(
    data: T[],
    groupKey: keyof T | ((row: T) => string),
    isGroupSelectable?: (firstRow: T) => boolean,
) {
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

    const getGroupId = useCallback(
        (row: T): string => {
            if (typeof groupKey === 'function') return groupKey(row);
            return String(row[groupKey as keyof T]);
        },
        [groupKey],
    );

    const selectedRows = useMemo(
        () => data.filter((row) => selectedKeys.has(getGroupId(row))),
        [data, selectedKeys, getGroupId],
    );

    const clearSelection = () => setSelectedKeys(new Set());

    void isGroupSelectable; // 외부에서 allSelectableKeys 계산 시 사용

    return {
        selectionProps: {
            selectedRowKeys: selectedKeys,
            onSelectedRowKeysChange: setSelectedKeys,
        },
        selectedKeys,
        selectedRows,
        clearSelection,
    };
}
