/** @format */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { ArrowDown, ArrowUp } from 'lucide-react';

export interface TableColumn<T = unknown> {
    key: string;
    label: string;
    width?: string;
    align?: 'left' | 'center' | 'right';
    render?: (value: unknown, row: T, index: number) => React.ReactNode;
    sortable?: boolean;
}

// [수정] DataTableProps 타입을 조건부로 만들기 위해 Base와 조건부 타입을 분리합니다.
type BaseDataTableProps<T> = {
    data: T[];
    columns: TableColumn<T>[];
    rowKey: keyof T | ((row: T, index: number) => string);
    headerBgColor?: string;
    headerTextColor?: string;
    className?: string;
    tableClassName?: string;
    loading?: boolean;
    emptyMessage?: string;
    getRowClassName?: (row: T, index: number) => string;
    selectedRowClassName?: string;
};

// selectable이 true일 때만 요구되는 props
type SelectableTableProps<T> = {
    selectable: true;
    selectedRowKeys: Set<string>;
    onSelectedRowKeysChange: (newSelectedRowKeys: Set<string>) => void;
};

// selectable이 false이거나 없을 때 적용되는 props
type NonSelectableTableProps = {
    selectable?: false;
    selectedRowKeys?: never;
    onSelectedRowKeysChange?: never;
};

// [수정] 위 타입들을 조합하여 최종 DataTableProps 타입을 정의합니다.
export type DataTableProps<T> = BaseDataTableProps<T> & (SelectableTableProps<T> | NonSelectableTableProps);


    export function DataTable<T extends Record<string, unknown>>({
    data,
    columns,
    rowKey,
    selectable = false,
    // 아래 두 prop은 selectable이 true일 때만 TypeScript에 의해 요구됩니다.
    selectedRowKeys,
    onSelectedRowKeysChange,
    headerBgColor = 'bg-gray-100',
    headerTextColor = 'text-black',
    className,
    tableClassName,
    loading = false,
    emptyMessage = '데이터가 없습니다.',
    getRowClassName,
    selectedRowClassName = 'bg-blue-50',
}: DataTableProps<T>) {
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    const getRowId = useCallback((row: T, index: number): string => {
        if (typeof rowKey === 'function') {
            return rowKey(row, index);
        }
        return String(row[rowKey]);
    }, [rowKey]);

    const sortedData = useMemo(() => {
        const sortableData = [...data];
        if (sortConfig !== null) {
            sortableData.sort((a, b) => {
                const aValue = a[sortConfig.key];
                const bValue = b[sortConfig.key];
                if (aValue && bValue && typeof aValue === 'number' && typeof bValue === 'number') {
                    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                    return 0;
                }
                if (aValue && bValue && typeof aValue === 'string' && typeof bValue === 'string') {
                    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                    return 0;
                }
                return 0;
            });
        }
        return sortableData;
    }, [data, sortConfig]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig?.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // 선택 관련 로직은 selectable이 true일 때만 의미가 있습니다.
    const isAllSelected =
        selectable &&
        data.length > 0 &&
        selectedRowKeys !== undefined &&
        selectedRowKeys.size === data.length;

    const isIndeterminate =
        selectable &&
        selectedRowKeys !== undefined &&
        selectedRowKeys.size > 0 &&
        selectedRowKeys.size < data.length;

    const handleSelectAll = (checked: boolean) => {
        if (selectable && selectedRowKeys !== undefined) { // 타입 가드 역할
            const allRowIds = new Set(data.map((row, index) => getRowId(row, index)));
            onSelectedRowKeysChange(checked ? allRowIds : new Set());
        }
    };

    const handleSelectRow = (rowId: string, checked: boolean) => {
        if (selectable) { // 타입 가드 역할
            const newSelectedRowKeys = new Set(selectedRowKeys);
            if (checked) {
                newSelectedRowKeys.add(rowId);
            } else {
                newSelectedRowKeys.delete(rowId);
                if (onSelectedRowKeysChange) {
                    onSelectedRowKeysChange(newSelectedRowKeys);
                }
            }
        }
        return (
            <div className={cn('p-4 bg-white', className)}>
                <div className="flex items-center justify-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className={cn('p-4 bg-white', className)}>
                <div className="flex items-center justify-center h-32 text-gray-500">
                    {emptyMessage}
                </div>
            </div>
        );
    }

    return (
        <div className={cn('p-4 bg-white', className)}>
            <div className="border border-gray-300 bg-white overflow-x-auto">
                <Table className={cn('w-full border-collapse text-xs table-fixed', tableClassName)}>
                    <TableHeader>
                        <TableRow className={cn('border-b border-gray-300', headerBgColor)}>
                            {selectable && (
                                <TableHead className="w-[40px] text-center border-r pl-0 border-gray-300 font-normal h-8">
                                    <div className="flex justify-center items-center">
                                        <Checkbox
                                            className="w-4 h-4"
                                            checked={isAllSelected}
                                            onCheckedChange={handleSelectAll}
                                            aria-label="모두 선택"
                                            {...(isIndeterminate && {
                                                'data-state': 'indeterminate',
                                            })}
                                        />
                                    </div>
                                </TableHead>
                            )}
                            {columns.map((column) => (
                                <TableHead
                                    key={column.key}
                                    className={cn(
                                        'px-2 py-2 text-center border-r border-gray-300 font-bold text-xs h-8',
                                        headerTextColor,
                                        column.sortable && 'cursor-pointer hover:bg-gray-200'
                                    )}
                                    style={column.width ? { width: column.width } : undefined}
                                    onClick={() => column.sortable && handleSort(column.key)}
                                >
                                    <div className="flex items-center justify-center gap-1">
                                        {column.label}
                                        {column.sortable && sortConfig?.key === column.key && (
                                            sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                        )}
                                    </div>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedData.map((row, rowIndex) => {
                            const rowId = getRowId(row, rowIndex);
                            const isRowSelected = selectable && selectedRowKeys?.has(rowId);
                            const rowClassName = getRowClassName?.(row, rowIndex) || '';

                            return (
                                <TableRow
                                    key={rowId}
                                    className={cn(
                                        'border-b border-gray-300 h-6',
                                        isRowSelected && selectedRowClassName,
                                        rowClassName
                                    )}
                                >
                                    {selectable && (
                                        <TableCell className="text-center border-r border-gray-300 px-1 py-1 align-middle">
                                            <div className="flex justify-center items-center">
                                                <Checkbox
                                                    className="w-4 h-4"
                                                    checked={isRowSelected}
                                                    onCheckedChange={(checked) => handleSelectRow(rowId, checked as boolean)}
                                                    aria-label={`${rowId} 선택`}
                                                />
                                            </div>
                                        </TableCell>
                                    )}
                                    {columns.map((column) => {
                                        const value = row[column.key];
                                        const alignClass = column.align === 'left' ? 'text-left' :
                                            column.align === 'right' ? 'text-right' : 'text-center';

                                        return (
                                            <TableCell
                                                key={column.key}
                                                className={cn(
                                                    'border-r border-gray-300 px-2 py-1 align-middle text-black text-xs break-words',
                                                    alignClass
                                                )}
                                                style={{
                                                    ...(column.width ? { width: column.width, maxWidth: column.width } : {}),
                                                    wordBreak: 'break-word',
                                                    overflowWrap: 'break-word',
                                                    whiteSpace: 'normal',
                                                }}
                                            >
                                                {column.render ? column.render(value, row, rowIndex) : value}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

export function useDataTableSelection<T extends Record<string, any>>(
    data: T[],
    rowKey: keyof T | ((row: T, index: number) => string)
) {
    const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());

    const getRowId = useCallback((row: T, index: number): string => {
        if (typeof rowKey === 'function') {
            return rowKey(row, index);
        }
        return String(row[rowKey]);
    }, [rowKey]);

    const selectedRows = useMemo(() => {
        return data.filter((row, index) => selectedRowKeys.has(getRowId(row, index)));
    }, [data, selectedRowKeys, getRowId]);

    const onSelectedRowKeysChange = (newSelectedRowKeys: Set<string>) => {
        setSelectedRowKeys(newSelectedRowKeys);
    };

    const clearSelection = () => {
        setSelectedRowKeys(new Set());
    };

    return {
        selectionProps: {
            selectedRowKeys,
            onSelectedRowKeysChange,
        },
        selectedRows,
        selectedRowKeys,
        clearSelection,
    };
}