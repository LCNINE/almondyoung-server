import { useEffect, useRef } from 'react';
import {
  boxCheckLabelsKey,
  boxCheckWhat,
  shipmentOf,
  type BoxCheckLabel,
} from './boxChecks';
import type { WorkRuntime } from './OperationContext';
import type { StoredOperation } from './operationStore';
import { pendingWorkSummary, workNameOf } from './pendingWork';

const DEVICE_ID_KEY = 'almondwms.device.id';
/** 남은 것이 있는 동안 다시 올리는 간격 — 관리자 화면의 «마지막 보고»가 기기가 살아 있는지 말해 준다 */
export const REPORT_INTERVAL_MS = 10 * 60_000;
/** 바뀐 뒤 잠깐 모았다 보낸다 — 재시도 사이마다 보내지 않게 */
export const REPORT_DEBOUNCE_MS = 3_000;

/** 이 기기의 번호 — 처음 쓸 때 만들어 기기에 남긴다 */
export function deviceIdOf(storage: Storage = localStorage): string {
  const saved = storage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}

const REPORT_SEQ_KEY = 'almondwms.device.report-seq';

/** 보고 번호 — 뒤에 보낸 보고일수록 크다(시계가 뒤로 가도). 서버는 더 작은 번호를 늦게 온 옛 보고로 버린다 */
export function nextReportSeq(storage: Storage = localStorage): number {
  const last = Number(storage.getItem(REPORT_SEQ_KEY)) || 0;
  const seq = Math.max(Date.now(), last + 1);
  storage.setItem(REPORT_SEQ_KEY, String(seq));
  return seq;
}

export interface ReportedOperation {
  operationKey: string;
  method: string;
  path: string;
  workName: string;
  summary?: string;
  status: string;
  attempts: number;
  errorCode?: string;
  recordedAt: string;
}

/**
 * 서버에 올릴 결과 모름 — 응답을 못 받아 다시 보내야 하는 것만. 대기·첫 전송은 지금 오가는 중이라 뺀다.
 * 박스에 묶인 출고 스캔은 송장·상품 이름을 붙인다(본문에는 박스 id 와 바코드만 있다).
 */
export function reportableOperations(
  operations: readonly StoredOperation[],
  labels: Record<string, BoxCheckLabel> | undefined
): ReportedOperation[] {
  return operations
    .filter(
      (o) =>
        o.status === 'uncertain' || (o.status === 'sending' && o.attempts > 1)
    )
    .map((o) => {
      const box = shipmentOf(o.path);
      const label = box ? labels?.[box] : undefined;
      const summary = box
        ? `${label ? `송장 ${label.trackingNo} · ` : ''}${boxCheckWhat(o, label)}`
        : pendingWorkSummary(o);
      return {
        operationKey: o.id,
        method: o.method,
        path: o.path,
        workName: workNameOf(o.path) ?? '작업',
        ...(summary ? { summary: summary.slice(0, 300) } : {}),
        status: o.status,
        attempts: o.attempts,
        ...(o.errorCode ? { errorCode: o.errorCode.slice(0, 128) } : {}),
        recordedAt: new Date(o.createdAt).toISOString(),
      };
    });
}

const signatureOf = (list: readonly ReportedOperation[]) =>
  JSON.stringify(
    list.map((o) => [o.operationKey, o.status, o.attempts, o.errorCode ?? ''])
  );

/**
 * 이 기기에 남은 결과 모름을 서버에 올린다 — 기기를 바꾸거나 잊어도 관리자가 «기기 확인할 일»에서 보고 끝낼 수 있게.
 * 앱을 켤 때 한 번(앞 세션에 남은 기록을 맞추려고), 남은 것이 바뀔 때, 남아 있는 동안 10분마다 보낸다.
 * 서버가 결과가 정해졌다고 돌려준 키는 같은 키로 한 번 다시 확인한다 — 관리자가 버렸거나 이미 반영된 것이 기기에서도 끝난다.
 * 보내지 못하면 다음 기회에 다시 보낸다(작업은 막지 않는다).
 */
export function useDeviceWorkReport({
  runtime,
  operations,
  scope,
  station,
  workerName,
}: {
  runtime: WorkRuntime;
  operations: readonly StoredOperation[];
  /** 준비된 로그인 범위 — 없으면 보내지 않는다 */
  scope: string | null;
  /** 기기 종류를 아직 모르면(화면이 붙기 전) 보내지 않는다 */
  station: boolean | null;
  workerName: () => Promise<string | undefined>;
}) {
  const rechecked = useRef(new Set<string>());
  // 보고는 한 번에 하나씩 — 앞 보고가 끝난 뒤 다음 것을 보낸다(번호 순서와 도착 순서를 맞춘다)
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sentFor = useRef<string | null>(null);
  const latest = useRef({ runtime, operations, station, workerName });
  latest.current = { runtime, operations, station, workerName };
  const ready = scope !== null && station !== null;
  const list = signatureOf(reportableOperations(operations, undefined));
  // 로그인이 바뀌면 같은 목록이어도 그 작업자 몫으로 다시 올린다
  const signature = `${scope ?? ''}|${list}`;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const send = async () => {
      const { runtime: rt, operations: ops, station: kind } = latest.current;
      if (kind === null) return;
      const labels = await rt.store
        .draft<Record<string, BoxCheckLabel>>(
          boxCheckLabelsKey(await rt.getScope())
        )
        .catch(() => undefined);
      const sending = reportableOperations(ops, labels);
      const name = await latest.current.workerName().catch(() => undefined);
      const response = await rt.runner.request<{ decided?: unknown }>({
        method: 'PUT',
        path: `/inventory/devices/${deviceIdOf()}/unresolved-operations`,
        body: {
          reportSeq: nextReportSeq(),
          deviceKind: kind ? 'station' : 'handheld',
          ...(name ? { workerName: name.slice(0, 100) } : {}),
          operations: sending,
        },
      });
      if (cancelled) return;
      const reported = new Set(sending.map((o) => o.operationKey));
      const decided = (
        Array.isArray(response?.decided) ? response.decided : []
      ).filter(
        (key): key is string =>
          typeof key === 'string' &&
          reported.has(key) &&
          !rechecked.current.has(key)
      );
      decided.forEach((key) => rechecked.current.add(key));
      if (decided.length) await rt.runner.recheck(decided);
    };
    // 보낸 것으로 치는 건 서버가 받았을 때다 — 못 보냈으면 주기 보고가 다시 보낸다
    const run = () => {
      const next = queue.current.then(() =>
        send().then(() => {
          sentFor.current = signature;
        })
      );
      queue.current = next.catch(() => {});
    };
    const first =
      sentFor.current === signature
        ? undefined
        : setTimeout(run, REPORT_DEBOUNCE_MS);
    const periodic = setInterval(() => {
      // 빈 목록은 한 번 받아 주면 더 보낼 것이 없다
      if (list === '[]' && sentFor.current === signature) return;
      run();
    }, REPORT_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (first) clearTimeout(first);
      clearInterval(periodic);
    };
  }, [ready, signature, list]);
}
