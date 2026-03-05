// src/features/account-management/sales-channel/components/SalesChannelTable.tsx
'use client';

import React, { useMemo } from 'react';
import { DataTable, TableColumn } from '@/components/common/data-table';
import { SalesChannelMark, SalesChannelType } from '@/components/common/sales-channel-mark';
import type { SalesChannel } from '@/lib/types/dto/products';

interface SalesChannelTableProps {
    data: SalesChannel[];
    loading?: boolean;
    onEdit?: (channel: SalesChannel) => void;
    onDelete?: (channel: SalesChannel) => void;
    onApiKeyEdit?: (channel: SalesChannel) => void;
}

export function SalesChannelTable({
    data,
    loading = false,
    onEdit,
    onDelete,
    onApiKeyEdit,
}: SalesChannelTableProps) {
    const columns = useMemo((): TableColumn<SalesChannel>[] => [
        {
            key: 'type',
            label: '채널 타입',
            width: '120px',
            align: 'center',
            render: (_, row) => (
                <SalesChannelMark
                    channel={row.type as SalesChannelType}
                    size="sm"
                />
            )
        },
        { key: 'name', label: '판매처명' },
        { key: 'loginId', label: '로그인 아이디 (shop ID)', render: (_, row) => ((row.apiConfig as Record<string, unknown>)?.loginId as string || '-') },
        {
            key: 'password', label: '비밀번호 / OTP', render: (_, row) => {
                const cfg = (row.apiConfig || {}) as Record<string, unknown>;
                return `${Boolean(cfg.password) ? '••••••••' : '-'}${Boolean(cfg.hasOtp) ? ' / OTP' : ''}`;
            }
        },
        {
            key: 'apiKey', label: 'API 인증키', render: (_, row) => (
                <button
                    className="h-7 px-2 text-xs border border-orange-300 text-orange-600 rounded hover:bg-orange-50"
                    onClick={() => onApiKeyEdit?.(row)}
                >
                    API 인증키 수정
                </button>
            )
        },
        {
            key: 'actions', label: '기능', align: 'center', render: (_, row) => (
                <div className="flex items-center justify-center space-x-1">
                    <button
                        className="h-7 w-7 p-0 text-sm text-blue-600 hover:text-blue-700"
                        onClick={() => onEdit?.(row)}
                    >
                        수정
                    </button>
                    <button
                        className="h-7 w-7 p-0 text-sm text-red-600 hover:text-red-700"
                        onClick={() => onDelete?.(row)}
                    >
                        삭제
                    </button>
                </div>
            )
        },
    ], [onEdit, onDelete, onApiKeyEdit]);

    return (
        <DataTable<SalesChannel>
            data={data}
            columns={columns}
            rowKey="id"
            loading={loading}
            emptyMessage="등록된 판매처가 없습니다."
            headerBgColor="bg-[#DFF1FD]"
            headerTextColor="text-gray-700 font-normal"
        />
    );
}