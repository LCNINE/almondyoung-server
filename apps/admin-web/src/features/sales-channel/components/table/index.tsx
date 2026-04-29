'use client';

import { useCallback, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  useChannels,
  useDeleteChannel,
  useSalesChannelSites,
} from '@/lib/api/domains/sales-channel';
import { useDataTable } from '@/hooks/use-data-table';
import { useSalesChannelTableColumns } from '@/hooks/table/columns/use-sales-channel-table-columns';
import { useSalesChannelTableQuery } from '@/hooks/table/query/use-sales-channel-table-query';
import { DataTable } from '@/components/data-table';
import type { ChannelDto } from '@/lib/types/dto/products';
import { SalesChannelFilters } from '../filter-box';
import { ApiKeyDialog } from '../api-key-dialog';

const PAGE_SIZE = 20;

type SalesChannelTableProps = {
  onEdit: (channel: ChannelDto) => void;
};

export function SalesChannelTable({ onEdit }: SalesChannelTableProps) {
  const [apiKeyTarget, setApiKeyTarget] = useState<ChannelDto | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const rawSearchParams = useSearchParams();

  const { searchParams: query, raw } = useSalesChannelTableQuery({
    pageSize: PAGE_SIZE,
  });
  const {
    data: channelsResponse,
    isLoading,
    isFetching,
    error,
  } = useChannels(query);
  const { data: sites = [], isLoading: sitesLoading } =
    useSalesChannelSites('all');
  const deleteChannel = useDeleteChannel();

  const channels = channelsResponse?.data ?? [];

  const handleFilterChange = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(rawSearchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, rawSearchParams]
  );

  const handleDelete = useCallback(
    async (channel: ChannelDto) => {
      if (!confirm(`"${channel.name}" 판매처를 삭제하시겠습니까?`)) return;
      try {
        await deleteChannel.mutateAsync(channel.id);
        toast.success('판매처가 삭제되었습니다.');
      } catch {
        toast.error('판매처 삭제에 실패했습니다.');
      }
    },
    [deleteChannel]
  );

  const columns = useSalesChannelTableColumns({
    onEdit,
    onDelete: (channel) => {
      void handleDelete(channel);
    },
    onApiKeyEdit: setApiKeyTarget,
  });

  const { table } = useDataTable({
    data: channels,
    columns,
    count: channelsResponse?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <div>
      <div className="border-b p-4">
        <SalesChannelFilters
          sites={sites}
          filters={{ type: raw.type, search: raw.search }}
          onFilterChange={handleFilterChange}
        />
      </div>

      <DataTable
        table={table}
        isLoading={isLoading || sitesLoading}
        isFetching={isFetching}
        count={channelsResponse?.total ?? 0}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '등록된 판매처가 없습니다.' }}
      />

      {error && (
        <p className="px-4 py-2 text-sm text-destructive">
          데이터를 불러오는데 실패했습니다. 다시 시도해주세요.
        </p>
      )}

      <ApiKeyDialog
        open={!!apiKeyTarget}
        onOpenChange={(o) => !o && setApiKeyTarget(null)}
        channel={apiKeyTarget}
        onSuccess={() => toast.success('API 키가 수정되었습니다.')}
      />
    </div>
  );
}
