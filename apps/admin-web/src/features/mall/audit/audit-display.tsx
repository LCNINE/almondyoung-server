'use client';

import { useMemo } from 'react';
import { ImageOff } from 'lucide-react';
import { useAdminUsersByIds } from '@/lib/services/users/queries';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

export const ACTION_LABELS: Record<string, string> = {
  created: '생성',
  updated: '수정',
  published: '발행',
  rolled_back: '이전 버전 재발행',
  unpublished: '판매 중단',
  exposure_updated: '노출 정책 변경',
  deleted: '삭제',
  restored: '복구',
  hard_deleted: '영구 삭제',
  master_deleted: '상품 삭제',
  master_restored: '상품 복구',
  bulk_updated: '일괄 수정',
  bulk_activated: '일괄 재공개',
};

export function ProductThumbnail({
  fileId,
  size = 'md',
}: {
  fileId: string | null;
  size?: 'md' | 'lg';
}) {
  const src = resolvePublicFileUrl(fileId);
  const box = size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';

  return (
    <div className={`${box} shrink-0 overflow-hidden rounded bg-muted`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export function useUserNames(userIds: string[]) {
  const { data } = useAdminUsersByIds(userIds);

  return useMemo(() => {
    const names = new Map(
      (data?.data ?? []).map((u) => [u.id, u.username || u.loginId])
    );
    return (userId: string) => names.get(userId) ?? userId;
  }, [data]);
}
