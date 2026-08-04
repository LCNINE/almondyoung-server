// src/features/mall/bulk-sessions/session-detail/drafted-panel/item-actions.tsx
// drafted 패널의 행별 액션: 임시 버전 열기(있으면) + 제외.

'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { buildDraftEditPath } from '@/features/mall/my-drafts/lib/draft-edit-path';
import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

/** 제외는 되돌릴 수 없다 — 누르기 전에 한 번 더 확인한다. */
const EXCLUDE_CONFIRM =
  '제외한 행은 다시 넣을 수 없습니다. 풀린 임시 버전은 작성중인 상품 목록에 나타납니다.';

export function ItemActions({
  item,
  excluding,
  onExclude,
}: {
  item: BulkSessionItem;
  excluding: boolean;
  onExclude: (itemId: string) => void;
}) {
  function handleExclude() {
    if (!window.confirm(EXCLUDE_CONFIRM)) return;
    onExclude(item.id);
  }

  return (
    <div className="flex items-center gap-2">
      {/* 신규 생성 자체가 실패하면 masterId 가 없다 — 그럴 땐 링크를 두지 않는다. */}
      {item.masterId && item.draftVersionId && (
        <Link
          href={buildDraftEditPath(item.masterId, item.draftVersionId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          임시 버전 열기
        </Link>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={excluding || item.status === 'excluded'}
        onClick={handleExclude}
      >
        제외
      </Button>
    </div>
  );
}
