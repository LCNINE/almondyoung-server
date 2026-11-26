import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, TriangleAlert } from 'lucide-react';
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { scanWaitingMessage } from './panels';

export type ConnectionLoss = { phase: 'lost' | 'restored'; cause: 'queued' | 'dropped' };
export type ConnectionProbe = 'idle' | 'checking' | 'failed' | 'server';

export function ConnectionDialog({
  loss,
  probe,
  trackingNo,
  scanned,
  ordered,
  waiting,
  onCheck,
  onContinue,
}: {
  loss: ConnectionLoss;
  probe: ConnectionProbe;
  trackingNo: string;
  scanned: number;
  ordered: number;
  waiting: number;
  onCheck(): void;
  onContinue(): void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const restored = loss.phase === 'restored';

  useEffect(() => {
    titleRef.current?.focus();
  }, [restored]);

  useEffect(() => {
    const root = rootRef.current;
    const hidden = Array.from(document.body.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== root && !child.inert
    );
    hidden.forEach((child) => {
      child.inert = true;
    });

    return () => {
      hidden.forEach((child) => {
        child.inert = false;
      });
    };
  }, []);

  const Icon = restored ? Check : TriangleAlert;
  const status = restored
    ? '검수를 이어갈 수 있습니다.'
    : probe === 'checking'
      ? '서버 연결을 확인하고 있습니다.'
      : probe === 'failed'
        ? '아직 서버에 연결되지 않았습니다. 네트워크를 확인한 뒤 다시 눌러 주세요.'
        : probe === 'server'
          ? '서버가 아직 정상 응답하지 않습니다. 잠시 뒤 다시 눌러 주세요.'
          : '연결이 복구될 때까지 스캔할 수 없습니다.';

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-50 flex items-center justify-center bg-[#18181b55] p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-[490px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[9px] border border-[#d4d4d8] bg-white text-[#27272a] shadow-[0_15px_45px_#18181b30]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#e4e4e7] px-6 pt-[21px] pb-[17px] max-[600px]:p-[18px]">
          <h2
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="flex items-center gap-2.5 text-[19px] leading-[1.4] font-[650] tracking-[-0.5px] outline-none max-[600px]:text-[17px]"
          >
            <Icon className={restored ? 'h-5 w-5 text-[#52525b]' : 'h-5 w-5 text-[#b42318]'} strokeWidth={1.8} aria-hidden />
            {restored ? '서버 연결 복구' : '서버 연결 끊김'}
          </h2>
        </div>
        <div className="px-6 py-[22px] max-[600px]:px-[18px] max-[600px]:py-5">
          <p id={descriptionId} className="text-sm leading-[1.75]">
            {restored ? (
              loss.cause === 'dropped' ? (
                '마지막 상품을 다시 스캔해 주세요.'
              ) : (
                '보내지 못한 스캔을 보냈어요. 같은 상품은 다시 찍지 마세요.'
              )
            ) : (
              <>
                스캔이 반영되지 않았습니다.
                <br />
                네트워크 연결을 확인해 주세요.
              </>
            )}
          </p>
          {!restored && loss.cause === 'queued' && waiting > 0 ? (
            <p className="mt-2 text-xs leading-[1.6] text-[#71717a]">{scanWaitingMessage(waiting)}</p>
          ) : null}
          <dl className="mt-6 mb-[18px] flex flex-col gap-2.5">
            <div className="flex items-baseline text-[13px]">
              <dt className="w-[90px] shrink-0 text-[#71717a]">송장</dt>
              <dd className="tabular-nums">{formatTrackingNo(trackingNo)}</dd>
            </div>
            <div className="flex items-baseline text-[13px]">
              <dt className="w-[90px] shrink-0 text-[#71717a]">검수 수량</dt>
              <dd className="tabular-nums">
                {scanned} / {ordered}개{!restored ? <span className="ml-2.5 text-[11px] text-[#71717a]">유지</span> : null}
              </dd>
            </div>
          </dl>
          <p role="status" className="min-h-5 text-xs leading-[1.6] text-[#71717a]">
            {status}
          </p>
        </div>
        <div className="flex items-center justify-end gap-3.5 border-t border-[#e4e4e7] bg-[#fafafa] px-6 py-4 max-[600px]:px-[18px] max-[600px]:py-3.5">
          <button
            type="button"
            disabled={!restored && probe === 'checking'}
            onClick={restored ? onContinue : onCheck}
            className="rounded-[5px] border border-[#27272a] bg-[#27272a] px-[15px] py-2.5 text-[13px] font-semibold text-white hover:bg-[#3f3f46] disabled:opacity-50"
          >
            {restored ? '검수 계속하기' : '다시 연결 확인'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
