import type { ReactNode } from 'react';
import type { ScanRejection } from '@/lib/types/dto/fulfillment';
import {
  scanRejectionClears,
  scanRejectionHandoffText,
  scanRejectionWhat,
  scanRejectionWhen,
} from './scan-rejection-copy';

/**
 * 물류앱 출고 저장이 거절돼 관리자 손을 기다리는 상자. 풀리면 서버가 더는 싣지 않으므로 표시도 사라진다.
 * 다음 할 일(children)은 화면마다 가는 길이 달라 부르는 쪽이 정한다.
 * 관리자가 담당을 넘긴 뒤에는 관리자 할 일이 끝났으므로 작업자가 다시 찍기를 기다리는 표시로 바꾼다.
 */
export function ScanRejectionNotice({
  rejection,
  workerName,
  handoffWorkerName = '',
  compact = false,
  children,
}: {
  rejection: ScanRejection;
  /** 거절된 작업자 이름. 모르면 빈 문자열 */
  workerName: string;
  /** 담당을 넘겨받은 작업자 이름. 모르면 빈 문자열 */
  handoffWorkerName?: string;
  /** 표 칸 안에 넣을 때 */
  compact?: boolean;
  children?: ReactNode;
}) {
  if (rejection.handedOff) {
    return (
      <section
        aria-label="작업자가 다시 찍기를 기다림"
        className={
          compact
            ? 'mt-1 max-w-60 space-y-0.5 text-xs whitespace-normal text-slate-700'
            : 'space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800'
        }
      >
        <p className="font-semibold break-keep">
          작업자가 다시 찍기를 기다려요 —{' '}
          {scanRejectionHandoffText(rejection.handedOff, handoffWorkerName)}
        </p>
        <p className="break-keep">
          막혔던 것: {scanRejectionWhat(rejection)} ·{' '}
          {scanRejectionWhen(rejection, workerName)}
        </p>
        <p className="break-keep opacity-80">
          {scanRejectionClears(rejection)}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="물류앱에서 막힘"
      className={
        compact
          ? 'mt-1 max-w-60 space-y-0.5 text-xs whitespace-normal text-red-800'
          : 'space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900'
      }
    >
      <p className="font-semibold break-keep">
        물류앱에서 막힘 — {rejection.message}
      </p>
      <p className="break-keep">
        {scanRejectionWhat(rejection)} ·{' '}
        {scanRejectionWhen(rejection, workerName)}
      </p>
      {children}
      {scanRejectionClears(rejection) && (
        <p className="break-keep opacity-80">
          {scanRejectionClears(rejection)}
        </p>
      )}
    </section>
  );
}
