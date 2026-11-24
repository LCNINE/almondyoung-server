import { type DevicePrefs } from '../../core/data/devicePrefs';
import type { PrintRaw } from '../../core/hardware/print/labelPrinter';
import type { JoinOutcome } from './batchJoin';
import { ReprintLabelButton } from './ReprintLabelButton';

/** 「배치에 넣기」 결과 표시 — 막힘·사유 묶음·합류 결과(출력 실패면 다시 출력). */
export function JoinOutcomeView({
  outcome,
  labelPrinting,
  prefs,
  print,
}: {
  outcome: JoinOutcome | null;
  labelPrinting: boolean;
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  if (outcome === null) return null;
  if (outcome.kind === 'blocked') return <p role="alert">{outcome.message}</p>;
  if (outcome.kind === 'join_blocked') {
    return (
      <div role="alert" className="space-y-1">
        <p className="font-medium">넣지 못했어요 — 아래 사유를 먼저 처리해 주세요</p>
        {outcome.groups.map((group) => (
          <div key={group.reason}>
            <p className="text-sm font-medium">{group.title}</p>
            <ul className="text-sm">
              {group.rows.map((row, index) => (
                <li key={`${index}-${row}`}>{row}</li>
              ))}
            </ul>
            <p className="text-sm text-neutral-500">{group.guidance}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p role="status">{outcome.message}</p>
      {labelPrinting && (outcome.print === 'failed' || outcome.print === 'no_printer') && (
        <ReprintLabelButton shipmentId={outcome.shipmentId} prefs={prefs} print={print} />
      )}
    </div>
  );
}
