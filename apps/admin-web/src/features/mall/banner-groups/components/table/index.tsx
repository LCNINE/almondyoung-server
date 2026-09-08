'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBannerGroups, useDeleteBannerGroup } from '@/lib/services/products';
import type { BannerGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { BannerGroupCreateDialog } from '../create-dialog';
import { BannerGroupDeleteDialog } from '../delete-dialog';
import { BannerGroupRow } from '../group-row';
import { CategoryTabs } from '../category-tabs';

export function BannerGroupsTable() {
  const { data, isLoading } = useBannerGroups();
  const deleteMutation = useDeleteBannerGroup();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BannerGroupDto | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const allGroups = data ?? [];
  /** 시안의 고정 8개 대신 실제 category 값에서 뽑는다 — 자유 입력이라 늘고 준다 */
  const categories = [...new Set(allGroups.map((g) => g.category))].filter(
    (c): c is string => !!c
  );
  const rows = category
    ? allGroups.filter((g) => g.category === category)
    : allGroups;

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      toast.success('배너 그룹이 삭제되었습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <div className="px-8 py-6">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[20px] leading-[18px] font-bold text-[#1f2937]">
          배너 그룹
        </h2>
        <Button
          size="sm"
          className="ml-auto bg-[#f29219] hover:bg-[#df7b00]"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          그룹 만들기
        </Button>
      </div>

      {categories.length > 1 && (
        <CategoryTabs
          categories={categories}
          value={category}
          onChange={setCategory}
        />
      )}

      <div className="overflow-hidden rounded-[10px] border border-[#e4e4e7]">
        <div className="grid grid-cols-[210px_1fr_120px_100px] items-center gap-6 border-b border-[#e4e4e7] bg-[#f9fafb] px-6 py-3 text-[14px] font-semibold text-[#1f2937]">
          <span>등록된 배너</span>
          <span>그룹 정보</span>
          <span className="text-center">관리</span>
          <span className="text-center">표시상태</span>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground bg-white p-10 text-center text-sm">
            불러오는 중...
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white p-10 text-center">
            <p className="text-muted-foreground text-sm">
              등록된 배너 그룹이 없습니다.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setCreateOpen(true)}
            >
              첫 그룹 만들기
            </Button>
          </div>
        ) : (
          rows.map((group) => <BannerGroupRow key={group.id} group={group} />)
        )}
      </div>

      <BannerGroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <BannerGroupDeleteDialog
        open={!!deleteTarget}
        target={deleteTarget}
        isLoading={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
