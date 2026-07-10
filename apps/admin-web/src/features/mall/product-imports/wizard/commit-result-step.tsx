'use client';

import { Button } from '@/components/ui/button';
import type { CommitResultDto } from '@/lib/types/dto/product-import';

interface Props {
  result: CommitResultDto;
  onGoToSession: () => void;
}

export function CommitResultStep({ result, onGoToSession }: Props) {
  const failedItems = result.items.filter((i) => i.status === 'failed');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">3. 커밋 결과</h3>
        <p className="text-xs text-muted-foreground">
          성공{' '}
          <strong className="text-green-600">{result.createdCount}</strong> · 실패{' '}
          <strong className="text-destructive">{result.failedCount}</strong>{' '}
          — 상품은 draft 로 생성되었습니다. 세션 상세에서 검토 후 게시하세요.
        </p>
      </div>

      {failedItems.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            실패한 행 ({failedItems.length}개)
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {failedItems.map((i) => (
              <li key={i.rowNumber}>
                행 {i.rowNumber} ({i.productKey}) — {i.errorMessage}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={onGoToSession}>세션 상세로 이동</Button>
    </div>
  );
}
