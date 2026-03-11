/** @format */

// src/app/(admin)/account/sales-channel/page.tsx
'use client';

import { Button } from '@/components/common/button';
import { Pagination } from '@/components/common/pagination';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { ApiKeyDialog } from '@/features/order/sales-channel/components/ApiKeyDialog';
import { SalesChannelFilters } from '@/features/order/sales-channel/components/SalesChannelFilters';
import { SalesChannelForm } from '@/features/order/sales-channel/components/SalesChannelForm';
import { SalesChannelTable } from '@/features/order/sales-channel/components/SalesChannelTable';
import {
  useChannelList,
  useDeleteChannel,
  useSalesChannelSites,
} from '@/lib/services/products';

import { adaptPagination } from '@/lib/api/adapters/pagination';

import RouteGuard from '@/components/layout/route-guard';
import type { ChannelDto as SalesChannel, ChannelsQuery as SalesChannelQueryDto } from '@/lib/types/dto/products';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export default function SalesChannelPage() {
  const [filters, setFilters] = useState<SalesChannelQueryDto>({
    page: 1,
    limit: 20,
  });
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<SalesChannel | null>(
    null
  );
  const [apiKeyTarget, setApiKeyTarget] = useState<SalesChannel | null>(null);

  const {
    data: channelsResponse,
    isLoading: channelsLoading,
    error: channelsError,
  } = useChannelList();
  const { data: sites = [], isLoading: sitesLoading } =
    useSalesChannelSites('all');
  const deleteChannel = useDeleteChannel();

  const channels: SalesChannel[] = channelsResponse?.data ?? [];

  const pagination = adaptPagination(channelsResponse, {
    totalKey: 'total',
    pageKey: 'page',
    limitKey: 'limit',
  });

  const handleFilterChange = useCallback(
    (newFilters: SalesChannelQueryDto) =>
      setFilters({ ...newFilters, page: 1, limit: filters.limit }),
    [filters.limit]
  );
  const handlePageChange = useCallback(
    (page: number) => setFilters((prev) => ({ ...prev, page })),
    []
  );
  const handleItemsPerPageChange = useCallback(
    (limit: number) => setFilters((prev) => ({ ...prev, limit, page: 1 })),
    []
  );
  const handleNewChannel = useCallback(() => {
    setEditingChannel(null);
    setShowChannelForm(true);
  }, []);
  const handleEditChannel = useCallback((channel: SalesChannel) => {
    setEditingChannel(channel);
    setShowChannelForm(true);
  }, []);
  const handleDeleteChannel = useCallback(
    async (channel: SalesChannel) => {
      if (!confirm(`"${channel.name}" 판매처를 삭제하시겠습니까?`)) return;
      try {
        await deleteChannel.mutateAsync(channel.id);
        toast.success('판매처가 삭제되었습니다.');
      } catch {
        toast.error('판매처 삭제에 실패했습니다.');
      }
    },
    [deleteChannel, toast]
  );
  const handleApiKeyEdit = useCallback(
    (channel: SalesChannel) => setApiKeyTarget(channel),
    []
  );
  const handleFormSuccess = useCallback(() => {
    setShowChannelForm(false);
    setEditingChannel(null);
    toast.success(
      editingChannel ? '판매처가 수정되었습니다.' : '판매처가 생성되었습니다.'
    );
  }, [editingChannel, toast]);

  const isLoading = channelsLoading || sitesLoading;

  return (
    <RouteGuard
      requireRole={['admin', 'master']}
    >
      <div className="flex flex-col h-full min-h-screen">
        <div className="p-6 space-y-6 flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                판매처 관리
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                채널별 판매처를 관리하고 등록하세요
              </p>
            </div>
            <div>
              <Button variant="primary" onClick={handleNewChannel}>
                판매처 등록
              </Button>
            </div>
          </div>

          <Card className="bg-white border-gray-200">
            <CardContent className="p-4">
              <SalesChannelFilters
                sites={sites}
                filters={filters}
                onFilterChange={handleFilterChange}
              />
            </CardContent>
          </Card>

          {channelsError && (
            <Alert variant="destructive">
              <AlertDescription>
                데이터를 불러오는데 실패했습니다. 다시 시도해주세요.
              </AlertDescription>
            </Alert>
          )}

          <Card className="flex-1 bg-white border-gray-200">
            <CardContent className="p-0">
              <SalesChannelTable
                data={channels}
                loading={isLoading}
                onEdit={handleEditChannel}
                onDelete={handleDeleteChannel}
                onApiKeyEdit={handleApiKeyEdit}
              />
              {pagination.totalItems > 0 && (
                <div className="px-6 py-4 border-t border-gray-200 bg-white">
                  <Pagination
                    {...pagination}
                    onPageChange={handlePageChange}
                    onItemsPerPageChange={handleItemsPerPageChange}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <SalesChannelForm
          open={showChannelForm}
          onOpenChange={setShowChannelForm}
          onSuccess={handleFormSuccess}
          editingChannel={editingChannel}
        />
        <ApiKeyDialog
          open={!!apiKeyTarget}
          onOpenChange={(o) => !o && setApiKeyTarget(null)}
          channel={apiKeyTarget}
          onSuccess={() => toast.success('API 키가 수정되었습니다.')}
        />
      </div>
    </RouteGuard>
  );
}
