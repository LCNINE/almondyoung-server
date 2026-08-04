'use client';

import { getBulkSessionView } from '@/lib/services/products/bulk-session-model';
import { useBulkSessionProgress } from '@/lib/services/products/bulk-session';
import { CanceledPanel } from './canceled-panel';
import { DraftedPanel } from './drafted-panel';
import { FailedPanel } from './failed-panel';
import { BulkSessionHeader } from './header';
import { ImagesPanel } from './images-panel';
import { PublishedPanel } from './published-panel';
import { ReviewPanel } from './review-panel';
import { WorkingPanel } from './working-panel';

export default function BulkSessionDetail({
  sessionId,
}: {
  sessionId: string;
}) {
  const {
    data: progress,
    isPending,
    isError,
  } = useBulkSessionProgress(sessionId);

  if (isPending)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        세션을 불러오는 중입니다…
      </p>
    );
  if (isError || !progress) {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        세션을 찾을 수 없습니다.
      </p>
    );
  }

  const view = getBulkSessionView(progress.phase);

  return (
    <div className="flex flex-col gap-4">
      <BulkSessionHeader sessionId={sessionId} progress={progress} />
      {view === 'working' && <WorkingPanel progress={progress} />}
      {view === 'review' && (
        <ReviewPanel sessionId={sessionId} progress={progress} />
      )}
      {view === 'images' && (
        <ImagesPanel sessionId={sessionId} progress={progress} />
      )}
      {view === 'drafted' && (
        <DraftedPanel sessionId={sessionId} progress={progress} />
      )}
      {view === 'published' && (
        <PublishedPanel sessionId={sessionId} progress={progress} />
      )}
      {view === 'canceled' && <CanceledPanel sessionId={sessionId} />}
      {view === 'failed' && <FailedPanel progress={progress} />}
    </div>
  );
}
