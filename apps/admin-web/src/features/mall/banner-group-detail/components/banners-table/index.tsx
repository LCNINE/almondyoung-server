'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useBannerGroup,
  useBannersByGroup,
  useDeleteBanner,
  useUpdateBanner,
} from '@/lib/services/products';
import type { BannerDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { productQueryKeys } from '@/lib/services/products';
import { localInputToIso } from '@/lib/utils/datetime';
import { BannerCreateDialog } from '../banner-create-dialog';
import { BannerEditDialog } from '../banner-edit-dialog';
import { BannerDeleteDialog } from '../banner-delete-dialog';
import { BannerPreviewDialog } from '../banner-preview-dialog';
import { BannerListDialog } from '../banner-list-dialog';
import { BannerRow, type BannerDraft } from '../banner-row';
import { BannerSection } from '../section';
import { heroListProgress } from '../banner-list-fields';
import { HERO_GROUP_CODE } from '../../banner-image-guide';

type Props = {
  groupId: string;
};

export function BannersTable({ groupId }: Props) {
  const { data, isLoading } = useBannersByGroup(groupId);
  const { data: group } = useBannerGroup(groupId);
  const deleteMutation = useDeleteBanner();
  const updateMutation = useUpdateBanner();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BannerDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BannerDto | null>(null);
  const [previewTarget, setPreviewTarget] = useState<BannerDto | null>(null);
  const [listTarget, setListTarget] = useState<BannerDto | null>(null);
  const [movedId, setMovedId] = useState<string | null>(null);
  /** 행에서 고친 값. 저장을 누를 때까지 서버에 안 보낸다 */
  const [drafts, setDrafts] = useState<Record<string, BannerDraft>>({});

  const rows = data ?? [];
  const draftOf = (b: BannerDto): BannerDraft => ({
    title: b.title,
    linkUrl: b.linkUrl,
    isActive: b.isActive,
    displayStartAt: b.displayStartAt,
    displayEndAt: b.displayEndAt,
    ...drafts[b.id],
  });
  const dirtyIds = Object.keys(drafts);
  const isHero = group?.code === HERO_GROUP_CODE;
  const listProgress = isHero ? heroListProgress(rows) : null;

  const pcSlot =
    group?.pcWidth && group?.pcHeight
      ? { width: group.pcWidth, height: group.pcHeight }
      : null;
  const mobileSlot =
    group?.mobileWidth && group?.mobileHeight
      ? { width: group.mobileWidth, height: group.mobileHeight }
      : null;

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, groupId });
      toast.success('배너가 삭제되었습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  /** 보이는 순서를 0..n-1 로 다시 매긴다 — 원래 값끼리 바꾸면 동점일 때 안 움직인다 */
  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const moving = rows[index];
    try {
      await Promise.all([
        updateMutation.mutateAsync({
          id: moving.id,
          dto: { sortOrder: target },
        }),
        updateMutation.mutateAsync({
          id: rows[target].id,
          dto: { sortOrder: index },
        }),
      ]);
      setMovedId(moving.id);
      window.setTimeout(
        () => setMovedId((v) => (v === moving.id ? null : v)),
        1500
      );
    } catch {
      // 두 건 중 한 건만 성공하면 sortOrder 가 겹쳐 조회마다 순서가 뒤집힌다.
      // 화면을 서버 상태로 되돌려 무엇이 반영됐는지 보이게 한다
      await queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannersByGroup(groupId),
      });
      toast.error('순서 변경에 실패했습니다. 목록을 다시 불러왔습니다.');
    }
  };

  const handleSaveAll = async () => {
    try {
      await Promise.all(
        dirtyIds.map((id) => {
          const row = rows.find((r) => r.id === id);
          if (!row) return Promise.resolve();
          const d = draftOf(row);
          return updateMutation.mutateAsync({
            id,
            dto: {
              title: d.title,
              linkUrl: d.linkUrl,
              isActive: d.isActive,
              displayStartAt: localInputToIso(d.displayStartAt),
              displayEndAt: localInputToIso(d.displayEndAt),
            },
          });
        })
      );
      setDrafts({});
      toast.success(`배너 ${dirtyIds.length}건이 저장되었습니다.`);
    } catch {
      toast.error('저장에 실패했습니다.');
    }
  };

  return (
    <>
      <BannerSection
        title="배너 리스트"
        action={
          <div className="ml-auto flex items-center gap-3">
            {listProgress && listProgress.total > 0 && (
              <span className="text-muted-foreground text-xs">
                {listProgress.filled === listProgress.total ? (
                  <>
                    리스트 {listProgress.total}/{listProgress.total} · 배너
                    오른쪽에 리스트가 나오는 중
                  </>
                ) : (
                  <>
                    리스트 {listProgress.filled}/{listProgress.total} ·{' '}
                    {listProgress.total - listProgress.filled}장 더 채우면
                    나타납니다
                  </>
                )}
              </span>
            )}
            {dirtyIds.length > 0 && (
              <>
                <span className="text-xs text-[#b45309]">
                  수정한 배너 {dirtyIds.length}건이 아직 저장되지 않았습니다
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDrafts({})}
                >
                  되돌리기
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant={dirtyIds.length > 0 ? 'default' : 'outline'}
              className={
                dirtyIds.length > 0
                  ? 'bg-[#f29219] hover:bg-[#df7b00]'
                  : 'bg-white'
              }
              disabled={dirtyIds.length === 0 || updateMutation.isPending}
              onClick={handleSaveAll}
            >
              저장
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => setCreateOpen(true)}
            >
              <ImagePlus className="mr-1 h-4 w-4" />
              배너 추가
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-[6px] border border-[#e4e4e7]">
          {isLoading ? (
            <div className="text-muted-foreground bg-white p-10 text-center text-sm">
              불러오는 중...
            </div>
          ) : rows.length === 0 ? (
            <div className="bg-white p-10 text-center">
              <p className="text-muted-foreground text-sm">
                등록된 배너가 없습니다.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setCreateOpen(true)}
              >
                첫 배너 추가하기
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[76px_210px_1fr_100px] items-center gap-6 border-b border-[#e4e4e7] bg-[#f9fafb] px-6 py-3 text-[14px] font-semibold text-[#1f2937]">
                <span className="text-center">순서</span>
                <span className="text-center">이미지</span>
                <span>배너 정보</span>
                <span className="text-center">삭제</span>
              </div>
              {rows.map((banner, i) => (
                <BannerRow
                  key={banner.id}
                  banner={banner}
                  draft={draftOf(banner)}
                  index={i}
                  total={rows.length}
                  isHero={isHero}
                  isMoving={updateMutation.isPending}
                  justMoved={movedId === banner.id}
                  onChange={(patch) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [banner.id]: {
                        ...draftOf(banner),
                        ...prev[banner.id],
                        ...patch,
                      },
                    }))
                  }
                  onEditImages={() => setEditTarget(banner)}
                  onEditList={() => setListTarget(banner)}
                  onDelete={() => setDeleteTarget(banner)}
                  onPreview={() => setPreviewTarget(banner)}
                  onMove={(d) => handleMove(i, d)}
                />
              ))}
            </>
          )}
        </div>
      </BannerSection>

      <BannerCreateDialog
        open={createOpen}
        groupId={groupId}
        onOpenChange={setCreateOpen}
      />

      <BannerEditDialog
        open={!!editTarget}
        banner={editTarget}
        groupId={groupId}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      />

      <BannerPreviewDialog
        open={!!previewTarget}
        onOpenChange={(open) => {
          if (!open) setPreviewTarget(null);
        }}
        title={previewTarget?.title ?? ''}
        pcImageFileId={previewTarget?.pcImageFileId}
        mobileImageFileId={previewTarget?.mobileImageFileId}
        pcSlot={pcSlot}
        mobileSlot={mobileSlot}
        showList={isHero}
        listImageFileId={previewTarget?.listImageFileId}
        listLabel={previewTarget?.listLabel}
      />

      <BannerListDialog
        open={!!listTarget}
        banner={listTarget}
        onOpenChange={(open) => {
          if (!open) setListTarget(null);
        }}
      />

      <BannerDeleteDialog
        open={!!deleteTarget}
        target={deleteTarget}
        isLoading={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </>
  );
}
