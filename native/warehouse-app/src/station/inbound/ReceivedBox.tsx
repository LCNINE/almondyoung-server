import { useState } from 'react';
import type { BoxView } from '../../domains/inbound-shipment/types';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { BigPanel, WorkGrid, type BigPanelContent } from '../outbound/panels';
import { BoxGrid } from './BoxGrid';
import { BoxHeader } from './BoxHeader';
import { countsView, rowsOf } from './boxRows';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import { useBoxCancel } from './useBoxCancel';

/**
 * 확정된 상자(스펙 §5.6) — 읽기 전용으로 줄별 센 수량·«센 것/리스트대로»·리스트에 없던 물건을 보인다.
 * 기능키는 F11 «확정 취소» 하나(두 번). 취소가 되면 다시 연 상자로 `onCanceled` — 작업 화면이 빈칸에서 시작한다.
 * 취소 뒤에도 상자가 확정돼 있으면(다른 곳에서 다시 확정) 새로 읽은 상자를 보인다 — 취소 키는 집계 id 로 바뀐다.
 */
export function ReceivedBox({ box: opened, onCanceled, onBack }: { box: BoxView; onCanceled(next: BoxView): void; onBack(): void }) {
  const [box, setBox] = useState(opened);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <ReceivedBoxBody
      key={`${box.boxId}:${box.counts[0]?.id ?? ''}`}
      box={box}
      notice={notice}
      onCanceled={onCanceled}
      onStillReceived={(latest, text) => {
        setBox(latest);
        setNotice(text);
      }}
      onBack={onBack}
    />
  );
}

function ReceivedBoxBody({
  box,
  notice,
  onCanceled,
  onStillReceived,
  onBack,
}: {
  box: BoxView;
  notice: string | null;
  onCanceled(next: BoxView): void;
  onStillReceived(latest: BoxView, notice: string): void;
  onBack(): void;
}) {
  const cancel = useBoxCancel({ box, countIds: box.counts.map((c) => c.id), onCanceled, onStillReceived });
  const values = countsView(box);
  const actions: StationAction[] = [
    ...(cancel.action ? [cancel.action] : []),
    {
      ...INBOUND_BOX_ACTIONS.back,
      label: cancel.armed ? '돌아가기' : INBOUND_BOX_ACTIONS.back.label,
      enabled: true,
      run: () => (cancel.armed ? cancel.disarm() : onBack()),
    },
  ];
  useStationActions(actions);

  const status = cancel.status ?? (notice ? { tone: 'alert' as const, text: notice } : null);
  const content: BigPanelContent = status
    ? status.tone === 'alert'
      ? { kind: 'alert', message: status.text }
      : { kind: 'notice', title: status.text }
    : { kind: 'notice', title: '확정된 상자' };

  return (
    <section aria-label="확정된 상자" className="flex h-full min-h-0 flex-col gap-3">
      <BoxHeader box={box} />
      <div className="min-h-0 flex-1">
        <WorkGrid left={<BigPanel content={content} />} right={<BoxGrid rows={rowsOf(box.lines, values)} draft={values} cursor={-1} />} />
      </div>
    </section>
  );
}
