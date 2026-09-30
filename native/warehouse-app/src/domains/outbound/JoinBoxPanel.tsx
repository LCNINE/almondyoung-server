import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { fetchJoinCandidates, joinBoxIntoBatch, type JoinCandidate, type JoinOutcome } from './batchJoin';
import { ReprintLabelButton } from './ReprintLabelButton';

const NOT_FOUND = '이 번호로 넣을 수 있는 박스를 찾지 못했어요. 이 창고의 출고 대상인지 확인해 주세요.';

/** 시작된 배치에 급한 박스를 넣는다(스펙 §7). 주문번호·송장번호 입력이나 스캔 → 찾기 → (여럿이면 고르기) → 넣기·출력. */
export function JoinBoxPanel({
  batchId,
  prefs = localStoragePrefs,
  print = printRaw,
  labelPrinting,
  onClose,
}: {
  batchId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  labelPrinting: boolean;
  onClose: () => void;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [candidates, setCandidates] = useState<JoinCandidate[] | null>(null);
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타로 같은 박스를 두 번 넣거나 송장을 두 장 뽑지 않게 ref 로 막는다.
  const running = useRef(false);

  const guarded = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const runJoin = async (candidate: JoinCandidate) => {
    const result = await joinBoxIntoBatch(
      {
        api,
        print,
        printer: labelPrinting ? readLabelPrinter(prefs) : null,
        newKey: () => crypto.randomUUID(),
      },
      batchId,
      candidate,
    );
    setOutcome(result);
    setCandidates(null);
    if (result.kind === 'joined') {
      await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
      await queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
    }
  };

  const join = (candidate: JoinCandidate) => guarded(() => runJoin(candidate));

  const find = (value: string) =>
    guarded(async () => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setOutcome(null);
      setNotice(null);
      setCandidates(null);
      try {
        const found = await fetchJoinCandidates(api, batchId, trimmed);
        if (found.length === 0) setNotice(NOT_FOUND);
        else if (found.length > 1) setCandidates(found);
        else await runJoin(found[0]);
      } catch (error) {
        setNotice(errorMessage(error, 'outbound'));
      }
    });

  useScanner((event) => void find(event.code));

  return (
    <section className="space-y-2 rounded border border-blue-300 px-3 py-2">
      <p className="font-medium">이 배치에 박스 넣기</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find(code);
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label="주문번호 또는 송장번호"
          placeholder="주문번호 또는 송장번호"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          찾기
        </Button>
      </form>
      {notice !== null && <p role="alert">{notice}</p>}
      {candidates !== null && (
        <ul className="space-y-1">
          {candidates.map((candidate) => (
            <li key={candidate.shipmentId} className="rounded border px-2 py-1">
              <p className="text-sm">
                주문 {candidate.orderNos.join(', ')} · {candidate.recipientMasked} · {candidate.totalQty}개
              </p>
              <p className="text-xs text-neutral-500">
                {candidate.lines.map((line) => `${line.skuName} ${line.qty}`).join(', ')}
              </p>
              <Button type="button" disabled={busy} onClick={() => void join(candidate)}>
                이 박스 넣기
              </Button>
            </li>
          ))}
        </ul>
      )}
      {outcome?.kind === 'blocked' && <p role="alert">{outcome.message}</p>}
      {outcome?.kind === 'join_blocked' && (
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
      )}
      {outcome?.kind === 'joined' && (
        <div className="space-y-1">
          <p role="status">{outcome.message}</p>
          {labelPrinting && (outcome.print === 'failed' || outcome.print === 'no_printer') && (
            <ReprintLabelButton shipmentId={outcome.shipmentId} prefs={prefs} print={print} />
          )}
        </div>
      )}
      <Button type="button" className="border border-gray-300 bg-white text-gray-700" onClick={onClose}>
        닫기
      </Button>
    </section>
  );
}
