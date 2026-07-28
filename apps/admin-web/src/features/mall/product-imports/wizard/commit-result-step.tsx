'use client';

import { Button } from '@/components/ui/button';
import type { CommitAcceptedDto } from '@/lib/types/dto/product-import';

interface Props {
  result: CommitAcceptedDto;
  onGoToSession: () => void;
}

export function CommitResultStep({ result, onGoToSession }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">3. 접수 완료</h3>
        <p className="text-xs text-muted-foreground">
          총 <strong>{result.totalRows}</strong>행 중{' '}
          <strong className="text-green-600">{result.queuedCount}</strong>건이
          접수되었습니다 — 생성이 진행 중입니다. 검증에서 이미 걸러진{' '}
          <strong className="text-destructive">{result.invalidCount}</strong>건은
          대상에서 제외되었습니다. 세션 상세에서 진행률을 확인하세요.
        </p>
      </div>

      <Button onClick={onGoToSession}>세션 상세로 이동</Button>
    </div>
  );
}
