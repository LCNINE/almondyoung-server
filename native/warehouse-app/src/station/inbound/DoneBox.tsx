import { Check } from 'lucide-react';
import { cn } from '../../core/design/cn';
import type { BoxView, ReceiveBoxResult } from '../../domains/inbound-shipment/types';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import { useBoxCancel } from './useBoxCancel';

/**
 * 끝(스펙 §5.6) — 방금 확정한 상자. 대기 위에 띄우고, 다음 상자 이름을 치기 전까지 F11 «확정 취소»(두 번)를 둔다.
 * 취소 키는 확정 응답의 집계 id 로 — 그 상자를 찾아 열었을 때(확정된 상자)와 같은 초안이다.
 */
export function DoneBox({
  box,
  result,
  onCanceled,
  onStillReceived,
}: {
  box: BoxView;
  result: ReceiveBoxResult;
  onCanceled(next: BoxView): void;
  onStillReceived(latest: BoxView, notice: string): void;
}) {
  const cancel = useBoxCancel({ box, countIds: result.countIds, onCanceled, onStillReceived });
  const actions: StationAction[] = cancel.action
    ? [
        cancel.action,
        // 한 번 누른 F11 은 Esc 로 거둔다 — 아니면 화면의 Esc(대기)
        ...(cancel.armed ? [{ ...INBOUND_BOX_ACTIONS.back, label: '돌아가기', enabled: true, run: cancel.disarm }] : []),
      ]
    : [];
  useStationActions(actions);

  return (
    <div
      role="status"
      aria-label="확정"
      className="flex shrink-0 flex-col gap-2 rounded-[10px] border-2 border-[#8CC8A4] bg-[#E3F4EA] px-[22px] py-4"
    >
      <div className="flex items-center gap-[18px]">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1E7A46] text-white">
          <Check className="h-7 w-7" aria-hidden />
        </span>
        <span className="text-2xl font-semibold text-[#145232]">{`${box.label} 확정 — 적치 대기로 갔어요`}</span>
      </div>
      {result.shipmentStatus === 'closed' ? <p className="text-lg font-semibold text-[#145232]">이 선적의 상자를 다 받았어요</p> : null}
      {cancel.status ? (
        <p className={cn('text-lg font-semibold', cancel.status.tone === 'alert' ? 'text-[#9E1320]' : 'text-[#5E3B00]')}>
          {cancel.status.text}
        </p>
      ) : null}
    </div>
  );
}
