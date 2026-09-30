'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { AlimtalkCampaign } from '@/lib/api/domains/alimtalk';
import { useAlimtalkCampaignResults } from '@/lib/services/alimtalk';
import { failureListTitle } from '../lib/alimtalk';

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

export function CampaignResultsDialog({
  campaign,
  onClose,
}: {
  campaign: AlimtalkCampaign | null;
  onClose: () => void;
}) {
  const results = useAlimtalkCampaignResults(campaign?.campaignId ?? null);
  const data = results.data;

  return (
    <Dialog
      open={campaign !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign?.name} 수신 결과</DialogTitle>
        </DialogHeader>
        {results.isLoading && <Skeleton className="h-40 w-full" />}
        {results.isError && (
          <p className="text-destructive text-sm">
            결과를 불러오지 못했습니다.{' '}
            {results.error instanceof Error ? results.error.message : ''}
          </p>
        )}
        {data && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="카카오톡으로 받음" value={data.kakao} />
              <Stat label="문자로 대신 받음" value={data.sms} />
              <Stat
                label="못 받음"
                value={data.failed}
                hint="카카오톡·문자 모두 실패"
              />
              <Stat label="아직 처리 중" value={data.inProgress} />
            </div>
            {data.unknown > 0 && (
              <p className="text-muted-foreground text-xs">
                카카오가 결과를 돌려주지 않은 {data.unknown.toLocaleString()}
                건이 있습니다 (보낸 지 90일이 지난 건은 조회되지 않습니다).
              </p>
            )}
            {data.notAccepted.length > 0 && (
              <section className="flex flex-col gap-1 text-sm">
                <h4 className="font-semibold">카카오에 넘기지 못한 건</h4>
                {data.notAccepted.map((r) => (
                  <div
                    key={r.message}
                    className="flex justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 break-words">
                      {r.message || '사유 없음'}
                    </span>
                    <span className="shrink-0">
                      {r.count.toLocaleString()}건
                    </span>
                  </div>
                ))}
              </section>
            )}
            {data.failures.length > 0 && (
              <section className="flex flex-col gap-1 text-sm">
                <h4 className="font-semibold">
                  {failureListTitle(data.failed, data.failures.length)}
                </h4>
                {data.failures.map((f, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_120px_1fr] gap-2 text-xs"
                  >
                    <span className="truncate">{f.name || '-'}</span>
                    <span>{f.phone}</span>
                    <span className="text-muted-foreground truncate">
                      {f.reason}
                    </span>
                  </div>
                ))}
              </section>
            )}
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>
                {new Date(data.checkedAt).toLocaleString('ko-KR')} 기준
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => results.refetch()}
                disabled={results.isFetching}
              >
                다시 조회
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
