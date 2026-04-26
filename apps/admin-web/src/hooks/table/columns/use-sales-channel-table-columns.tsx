'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ChannelDto } from '@/lib/types/dto/products';
import { SalesChannelMark, type SalesChannelType } from '@/components/common/sales-channel-mark';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<ChannelDto>();

type UseSalesChannelTableColumnsProps = {
  onEdit: (channel: ChannelDto) => void;
  onDelete: (channel: ChannelDto) => void;
  onApiKeyEdit: (channel: ChannelDto) => void;
};

export function useSalesChannelTableColumns({
  onEdit,
  onDelete,
  onApiKeyEdit,
}: UseSalesChannelTableColumnsProps) {
  return useMemo(
    () => [
      columnHelper.accessor('type', {
        header: '채널 타입',
        cell: ({ getValue }) => (
          <SalesChannelMark channel={getValue() as SalesChannelType} size="sm" />
        ),
      }),
      columnHelper.accessor('name', {
        header: '판매처명',
      }),
      columnHelper.display({
        id: 'loginId',
        header: '로그인 아이디 (shop ID)',
        cell: ({ row }) => {
          const cfg = (row.original.config ?? {}) as Record<string, unknown>;
          return <span className="text-sm">{(cfg.loginId as string) || '-'}</span>;
        },
      }),
      columnHelper.display({
        id: 'password',
        header: '비밀번호 / OTP',
        cell: ({ row }) => {
          const cfg = (row.original.config ?? {}) as Record<string, unknown>;
          const pw = Boolean(cfg.password) ? '••••••••' : '-';
          const otp = Boolean(cfg.hasOtp) ? ' / OTP' : '';
          return <span className="text-sm">{`${pw}${otp}`}</span>;
        },
      }),
      columnHelper.display({
        id: 'apiKey',
        header: 'API 인증키',
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            className="border-orange-300 text-orange-600 hover:bg-orange-50"
            onClick={() => onApiKeyEdit(row.original)}
          >
            API 인증키 수정
          </Button>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '기능',
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700"
              onClick={() => onEdit(row.original)}
            >
              수정
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => onDelete(row.original)}
            >
              삭제
            </Button>
          </div>
        ),
      }),
    ],
    [onEdit, onDelete, onApiKeyEdit]
  );
}
