'use client';

import { useState } from 'react';
import { usePendingApprovals } from '@/lib/services/products';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ApprovalModal } from '../approval-modal';
import type { PendingApprovalDto } from '@/lib/types/dto/products';

export function PendingApprovalTable() {
  const { data, isLoading } = usePendingApprovals();
  const [selected, setSelected] = useState<PendingApprovalDto | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');

  function openModal(product: PendingApprovalDto, m: 'approve' | 'reject') {
    setSelected(product);
    setMode(m);
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">로딩 중...</p>;
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">승인 대기 상품이 없습니다.</p>
    );
  }

  return (
    <>
      <div className="divide-y rounded-lg border">
        {data.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {item.approvalStatus}
                </Badge>
                {item.submittedAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.submittedAt).toLocaleDateString('ko-KR')}
                  </span>
                )}
              </div>
            </div>
            <div className="ml-4 flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => openModal(item, 'approve')}
              >
                승인
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => openModal(item, 'reject')}
              >
                거부
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ApprovalModal
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        mode={mode}
        product={selected}
        onSuccess={() => setSelected(null)}
      />
    </>
  );
}
