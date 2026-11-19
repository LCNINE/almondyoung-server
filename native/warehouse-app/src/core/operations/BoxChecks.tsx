import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../design/Button';
import { cn } from '../design/cn';
import { errorMessage } from '../data/errorMessage';
import { useWorkRuntime } from './OperationContext';
import { boxCheckLabelsKey, shipmentOf, type BoxCheckLabel } from './boxChecks';
import { storedRejection } from './operationRunner';
import type { StoredOperation } from './operationStore';
import { useBoxChecks } from './workArea';

type Result =
  | { kind: 'applied' }
  | { kind: 'rejected'; message: string }
  | { kind: 'unknown' };

interface Group {
  shipmentId: string;
  operations: StoredOperation[];
}

function groupsOf(operations: readonly StoredOperation[]): Group[] {
  const map = new Map<string, StoredOperation[]>();
  for (const op of operations) {
    const id = shipmentOf(op.path);
    if (!id) continue;
    map.set(id, [...(map.get(id) ?? []), op]);
  }
  return [...map].map(([shipmentId, ops]) => ({
    shipmentId,
    operations: ops,
  }));
}

function whatOf(op: StoredOperation): string {
  try {
    const body = JSON.parse(op.bodyJson) as {
      barcode?: unknown;
      quantity?: unknown;
    };
    if (typeof body.barcode === 'string')
      return `상품 바코드 ${body.barcode} ×${typeof body.quantity === 'number' ? body.quantity : 1}`;
  } catch {
    // 본문을 못 읽으면 무엇을 했는지만 적는다
  }
  return op.path.endsWith('-forces') ? '강제출고' : '박스 작업';
}

const clock = (at: number) => {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

const RESULT_TEXT: Record<Exclude<Result['kind'], 'rejected'>, string> = {
  applied: '반영됐어요. 이 상품은 다시 찍지 마세요.',
  unknown: '아직 확인하지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.',
};

/**
 * 기기의 «확인할 일» — 박스에 묶인 결과 모름을 박스별로 보이고, 같은 키로 다시 맞춘 결과를 보여 준 뒤 목록에서 뺀다.
 * 결과가 정해지면 그 박스의 저장된 스캔에서도 지운다 — 박스를 다시 열 때 이미 끝난 스캔을 재생하지 않게
 */
export function BoxChecks({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const runtime = useWorkRuntime();
  const checks = useBoxChecks();
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, BoxCheckLabel>>({});
  const [results, setResults] = useState<
    Record<string, { result: Result; trackingNo: string | null }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const groups = groupsOf(checks);
  const count = checks.length;

  const close = useCallback(() => {
    setOpen(false);
    setResults({});
  }, []);

  useEffect(() => {
    if (!open || !runtime) return;
    let live = true;
    void runtime
      .getScope()
      .then((scope) =>
        runtime.store.draft<Record<string, BoxCheckLabel>>(
          boxCheckLabelsKey(scope)
        )
      )
      .then((saved) => {
        if (live) setLabels(saved ?? {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, runtime, count]);

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!runtime || (count === 0 && !open)) return null;

  const recheck = async (group: Group) => {
    setBusy(group.shipmentId);
    try {
      const after = await runtime.runner.recheck(
        group.operations.map((op) => op.id)
      );
      const settled = after.filter((op) =>
        ['confirmed', 'rejected'].includes(op.status)
      );
      const rejected = settled.find((op) => op.status === 'rejected');
      const result: Result =
        settled.length < after.length || after.length === 0
          ? { kind: 'unknown' }
          : rejected
            ? {
                kind: 'rejected',
                message: errorMessage(storedRejection(rejected), 'outbound'),
              }
            : { kind: 'applied' };
      setResults((r) => ({
        ...r,
        [group.shipmentId]: {
          result,
          trackingNo: labels[group.shipmentId]?.trackingNo ?? null,
        },
      }));
    } catch {
      setResults((r) => ({
        ...r,
        [group.shipmentId]: {
          result: { kind: 'unknown' },
          trackingNo: labels[group.shipmentId]?.trackingNo ?? null,
        },
      }));
    } finally {
      setBusy(null);
    }
  };

  const finished = Object.entries(results).filter(
    ([id, r]) =>
      r.result.kind !== 'unknown' &&
      !groups.some((group) => group.shipmentId === id)
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'rounded bg-[#FFF1C7] px-2 font-semibold text-[#5E3B00]',
          compact ? '' : 'py-1',
          className
        )}
      >
        확인할 일 {count}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="확인할 일"
            tabIndex={-1}
            onKeyDown={(e) => {
              // 스캐너의 종단 Enter 가 단추를 누르지 않게
              if (e.key === 'Enter') e.preventDefault();
            }}
            className="max-h-[80vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg bg-white p-4 text-[15px] text-[#15171C] shadow-lg outline-none"
          >
            <h2 className="text-lg font-semibold">확인할 일</h2>
            <p className="text-sm text-[#3F4450]">
              처리됐는지 확인하지 못한 스캔이에요. 같은 상품은 다시 찍지 말고,
              «다시 확인»으로 서버 기록과 맞춰 주세요.
            </p>
            {groups.length === 0 && finished.length === 0 ? (
              <p>확인할 일이 없어요.</p>
            ) : null}
            <ul className="list-none space-y-2">
              {groups.map((group) => {
                const shown = results[group.shipmentId];
                return (
                  <li
                    key={group.shipmentId}
                    className="space-y-1 rounded-md border border-[#D5D8DE] p-3"
                  >
                    <p className="font-mono font-semibold">
                      {labels[group.shipmentId]?.trackingNo ??
                        '송장을 모르는 박스'}
                    </p>
                    <ul className="list-none text-sm">
                      {group.operations.map((op) => (
                        <li key={op.id}>
                          {clock(op.createdAt)} · {whatOf(op)}
                        </li>
                      ))}
                    </ul>
                    {shown?.result.kind === 'unknown' ? (
                      <p role="status" className="text-sm text-[#9E1320]">
                        {RESULT_TEXT.unknown}
                      </p>
                    ) : null}
                    <Button
                      disabled={busy !== null}
                      onClick={() => void recheck(group)}
                    >
                      {busy === group.shipmentId ? '확인 중…' : '다시 확인'}
                    </Button>
                  </li>
                );
              })}
              {finished.map(([id, shown]) => (
                <li
                  key={id}
                  role="status"
                  className="space-y-1 rounded-md border border-[#D5D8DE] bg-[#F6F7F9] p-3"
                >
                  <p className="font-mono font-semibold">
                    {shown.trackingNo ?? '송장을 모르는 박스'}
                  </p>
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      shown.result.kind === 'applied'
                        ? 'text-[#1E7A46]'
                        : 'text-[#9E1320]'
                    )}
                  >
                    {shown.result.kind === 'rejected'
                      ? shown.result.message.startsWith('반영되지')
                        ? shown.result.message
                        : `반영되지 않았어요. ${shown.result.message}`
                      : RESULT_TEXT.applied}
                  </p>
                </li>
              ))}
            </ul>
            <Button onClick={close}>닫기</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
