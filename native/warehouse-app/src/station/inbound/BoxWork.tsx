import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { useHumanKeys, useScanner } from '../../core/hardware/scan/useScanner';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { scanIncrement } from '../../domains/inbound/packingUnit';
import { isBlockedWrite, isUncertainWrite, openBox, receiveBox } from '../../domains/inbound-shipment/api';
import {
  applyList,
  applyScan,
  blankLineIds,
  canApplyList,
  clearLine,
  confirmBlock,
  createBoxDraft,
  reconcileDraft,
  reviewRows,
  setLineQty,
  setUnplannedQty,
  toReceiveBody,
  type BoxDraft,
  type ConfirmBlock,
  type ScanTarget,
} from '../../domains/inbound-shipment/boxDraft';
import type { BoxView, ReceiveBoxBody, ReceiveBoxResult } from '../../domains/inbound-shipment/types';
import type { SelectedSku } from '../../domains/inventory/SkuPicker';
import { useSkuByBarcode } from '../../domains/inventory/useSkuByBarcode';
import { useDigitCommands, useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { WorkGrid } from '../outbound/panels';
import { BoxGrid } from './BoxGrid';
import { blockNotice, rowKey, rowsOf, targetKey, type BoxRow } from './boxRows';
import { BoxHeader } from './BoxHeader';
import { BoxReview } from './BoxReview';
import { BoxWorkPanel } from './BoxWorkPanel';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';

const CONFLICT_NOTICE = '다른 곳에서 이미 확정했어요';
const STALE_CONFIRM = '앞서 보낸 확정이 취소됐어요 — 다시 세 주세요';
// 확정 409 인데 상자는 아직 열려 있다 — 러너가 409 를 ApiError 로 다시 만들어 공용 문구로는 «알 수 없는 오류» 가 된다
const SHIPMENT_ENDED = '이 선적은 끝났거나 취소됐어요 — 관리자에게 확인해 주세요';
const CANNOT_RECEIVE = '지금은 이 상자를 받을 수 없어요 — 상자를 다시 열어 확인해 주세요';
const listChangedMessage = (n: number) => `관리자가 리스트를 고쳤어요 — ${n}줄 다시 확인`;

type Phase = 'idle' | 'checking' | 'sending';

/**
 * 상자 작업(스펙 §5.4~§5.5) — 줄마다 센 수량을 넣고(숫자·스캔·F8 리스트대로·F9 리스트에 없던 물건) F10 두 번으로 확정한다.
 * 규칙(빈칸·리스트대로·스캔 매칭·확정 막기·본문)은 전부 `boxDraft` 몫이다 — 이 화면은 그 결과를 그리고 키를 잇는다.
 * 초안은 상자 id 로 기기에 남는다(§6). 보낸 본문(`sentBody`)이 초안에 있으면 결과를 모르는 것이라 칸을 잠그고,
 * F10 이 같은 키·같은 본문을 다시 보낸다 — 앱을 다시 켜도 초안에서 잠김이 되살아난다.
 */
export function BoxWork({
  box: opened,
  onDone,
  onReopen,
  onBack,
}: {
  box: BoxView;
  onDone(result: ReceiveBoxResult): void;
  /** 상자를 다시 읽어 그 상태대로 연다 — notice 는 다음 화면 위 한 줄 */
  onReopen(notice?: string): void;
  onBack(): void;
}) {
  const api = useApiClient();
  const runtime = useWorkRuntime();
  const { signal } = useFeedback();
  const permissions = useWorkPermissions();
  const canOperate = permissions.data?.inboundShipmentOperate === true;
  const lookup = useSkuByBarcode('always');
  const saved = useWorkDraft<BoxDraft | null>(`inbound-box:${opened.boxId}`, null);

  // 키 처리기는 한 렌더 안에 여럿 올 수 있다 — 판정은 늘 ref 로, 그리기는 state 로
  const [box, boxRef, setBox] = useRefState(opened);
  const [work, workRef, setWork] = useRefState<BoxDraft | null>(null);
  const [cursor, cursorRef, setCursor] = useRefState(0);
  // 줄을 고른 뒤 첫 숫자는 덮어쓴다, 그다음부터 이어 친다
  const freshRef = useRef(true);
  // Esc 되돌림 — 커서가 이 줄에 온 뒤 첫 변경 직전의 초안
  const [undo, undoRef, setUndo] = useRefState<BoxDraft | null>(null);
  const [armed, setArmed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [phase, phaseRef, setPhase] = useRefState<Phase>('idle');
  const [alert, setAlert] = useState<{ message: string; detail?: string } | null>(null);
  const mounted = useRef(true);
  // 이 키의 결과를 이미 처리했다 — 같은 키의 대기가 여럿 풀려도(재전송) 한 번만
  const settled = useRef<string | null>(null);
  // 마지막 전송 — 앞 전송의 늦은 finally 가 뒤 전송의 상태를 풀지 않게
  const sendSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** 화면과 기기에 함께 — 저장은 순서대로 이어진다 */
  const commit = (next: BoxDraft): Promise<void> => {
    setWork(next);
    return saved.update(() => next);
  };
  const rowsNow = (): BoxRow[] => (workRef.current ? rowsOf(boxRef.current.lines, workRef.current) : []);
  const moveTo = (index: number) => {
    setCursor(Math.max(0, Math.min(index, rowsNow().length - 1)));
    freshRef.current = true;
    setUndo(null);
  };
  const focusTarget = (target: ScanTarget) => moveTo(rowsNow().findIndex((r) => rowKey(r) === targetKey(target)));
  /** 입력을 다시 받는다 — 늦게 끝나는 앞 전송의 finally 는 이제 아무것도 풀지 않는다 */
  const release = () => {
    sendSeq.current++;
    setPhase('idle');
  };
  const busy = () => phaseRef.current !== 'idle';
  /** 이 상자의 초안을 기기에서 지운다 — 실패해도 다음 단계는 막지 않는다(다시 열면 결과 확인이 같은 판정을 한다) */
  const dropDraft = () => saved.update(() => null).catch(() => {});
  const locked = () => busy() || !!workRef.current?.sentBody;

  const listChanged = (n: number) => {
    moveTo(0);
    setAlert({ message: listChangedMessage(n) });
    signal('attention');
  };

  /** 확정을 막은 까닭을 한 줄로, 고칠 줄로 커서를 옮긴다 — 열린 재고 상자가 아니면 다시 연다 */
  const explain = (block: Exclude<ConfirmBlock, null>, draft: BoxDraft, current: BoxView) => {
    const notice = blockNotice(block);
    if (!notice) {
      // 다른 곳이 확정했다 — 넣던 수량은 버리고 확정된 상자를 연다(§5.9). 그 밖(전달용 등)은 초안을 두고 그 상태로 연다
      if (current.status === 'received') void dropDraft().then(() => onReopen(CONFLICT_NOTICE));
      else onReopen();
      return;
    }
    if (notice.focus) moveTo(rowsOf(current.lines, draft).findIndex((r) => rowKey(r) === notice.focus));
    setArmed(false);
    setAlert({ message: notice.message });
    signal('error');
  };

  /**
   * 확정 결과(방금 받은 것이든 기기에 남은 것이든)를 상자로 확인한다. 기기의 결과는 그 뒤 취소됐을 수 있다 —
   * 상자가 다시 열려 있으면 낡은 확정이라 «확정» 을 띄우지 않고 새 빈 초안(새 키)으로 다시 세게 한다.
   * 읽지 못하면 잠금을 둔다(F10 이 같은 키로 다시 받아 다시 확인한다).
   */
  const afterConfirmed = async (result: ReceiveBoxResult, key: string) => {
    let latest: BoxView;
    try {
      latest = await openBox(api, boxRef.current.shipmentId, boxRef.current.boxId);
    } catch {
      if (mounted.current) signal('error');
      return;
    }
    if (!mounted.current || settled.current === key) return;
    settled.current = key;
    if (latest.status === 'received') {
      await dropDraft();
      signal('complete');
      onDone(result);
      return;
    }
    setBox(latest);
    setUndo(null);
    await commit(createBoxDraft(latest, crypto.randomUUID())).catch(() => {});
    moveTo(0);
    setAlert({ message: STALE_CONFIRM });
    signal('error');
  };

  /**
   * 409 — 상자를 다시 읽어 그 상태를 보인다. 확정돼 있으면 다른 곳이 먼저 한 것(수량을 버린다), 아니면 수량을 두고 까닭을 보인다:
   * 다시 읽은 줄로 확정이 막히면 그 까닭, 선적이 끝났거나 취소됐으면 그렇다고, 그 밖은 상자를 다시 열어 보라고(§5.9).
   */
  const afterConflict = async (draft: BoxDraft) => {
    let latest: BoxView;
    try {
      latest = await openBox(api, boxRef.current.shipmentId, boxRef.current.boxId);
    } catch {
      if (!mounted.current) return;
      setAlert({ message: CANNOT_RECEIVE });
      signal('error');
      return;
    }
    if (!mounted.current) return;
    setBox(latest);
    const block = confirmBlock(draft, latest);
    if (block) {
      explain(block, draft, latest);
      return;
    }
    const ended = latest.shipmentStatus === 'closed' || latest.shipmentStatus === 'canceled';
    setAlert({ message: ended ? SHIPMENT_ENDED : CANNOT_RECEIVE });
    signal('error');
  };

  /** 확정을 보낸다 — 결과를 모르면(응답 없음·5xx) 초안의 sentBody 가 남아 잠긴다 */
  const transmit = async (body: ReceiveBoxBody, key: string) => {
    const mine = ++sendSeq.current;
    setPhase('sending');
    const current = boxRef.current;
    try {
      let result: ReceiveBoxResult;
      try {
        result = await receiveBox(api, current.shipmentId, current.boxId, body, key);
      } catch (error) {
        if (!mounted.current || settled.current === key) return;
        if (isBlockedWrite(error)) {
          // 보내지 않았다 — 방금 남긴 보낸 본문을 거둬 잠그지 않는다. 이 키로 나간 것이 없으니 키는 그대로 둔다
          const current = workRef.current;
          if (current?.key === key && current.sentBody) await commit({ ...current, sentBody: null }).catch(() => {});
          if (!mounted.current) return;
          setAlert({ message: error.message });
          signal('error');
          return;
        }
        if (isUncertainWrite(error)) {
          signal('error');
          return;
        }
        // 거절 — 수량은 남기고 다음 전송은 새 키로(§6)
        settled.current = key;
        setUndo(null);
        const rotated: BoxDraft | null = workRef.current ? { ...workRef.current, key: crypto.randomUUID(), sentBody: null } : null;
        if (rotated) await commit(rotated).catch(() => {});
        if (rotated && error instanceof ApiError && error.status === 409) {
          await afterConflict(rotated);
          return;
        }
        setAlert({ message: errorMessage(error) });
        signal('error');
        return;
      }
      if (!mounted.current || settled.current === key) return;
      await afterConfirmed(result, key);
    } finally {
      if (mounted.current && sendSeq.current === mine) release();
    }
  };
  const transmitRef = useRef(transmit);
  transmitRef.current = transmit;

  /** 두 번째 F10 — 상자를 다시 읽어 맞춘 뒤, 바뀐 줄이 없을 때만 보낸다(§6) */
  const recheckAndSend = async () => {
    setPhase('checking');
    let latest: BoxView;
    try {
      latest = await openBox(api, boxRef.current.shipmentId, boxRef.current.boxId);
    } catch (error) {
      if (!mounted.current) return;
      release();
      setArmed(false);
      setAlert({ message: errorMessage(error) });
      signal('error');
      return;
    }
    if (!mounted.current || !workRef.current) return;
    setArmed(false);
    setBox(latest);
    const { draft: next, changedLineIds } = reconcileDraft(workRef.current, latest);
    if (changedLineIds.length > 0) {
      release();
      void commit(next).catch(() => {});
      listChanged(changedLineIds.length);
      return;
    }
    const block = confirmBlock(next, latest);
    if (block) {
      release();
      void commit(next).catch(() => {});
      explain(block, next, latest);
      return;
    }
    const sent: BoxDraft = { ...next, sentBody: toReceiveBody(next, latest) };
    // 보낸 본문을 먼저 기기에 남긴다 — 응답 전에 꺼져도 다시 켜면 잠긴 채 같은 본문을 다시 보낸다
    const stored = await commit(sent).then(
      () => true,
      () => false
    );
    if (!mounted.current) return;
    if (!stored) {
      release();
      void commit(next).catch(() => {});
      setAlert({ message: '기기에 저장하지 못했어요 — F10 을 다시 눌러 주세요' });
      signal('error');
      return;
    }
    void transmit(sent.sentBody!, sent.key);
  };

  // 초안을 연다 — 없으면 새로(키 한 번), 있으면 지금 줄과 맞춘다. 보낸 본문이 있으면 맞추지 않는다(본문은 그대로 다시 보낸다)
  const loaded = useRef(false);
  useEffect(() => {
    if (!saved.ready || loaded.current) return;
    loaded.current = true;
    const value = saved.value;
    if (value?.sentBody) {
      const body = value.sentBody;
      setWork(value);
      // 작업 기록을 못 읽으면 잠긴 채 둔다(결과 모름 안내 · F10 이 같은 키로 다시)
      void runtime?.store
        .get(value.key)
        .then((op) => {
          if (op?.status === 'confirmed' || op?.status === 'rejected') void transmitRef.current(body, value.key);
        })
        .catch(() => {});
      return;
    }
    if (!value) {
      void commit(createBoxDraft(opened, crypto.randomUUID())).catch(() => {});
      return;
    }
    const { draft: next, changedLineIds } = reconcileDraft(value, opened);
    void commit(next).catch(() => {});
    if (changedLineIds.length > 0) listChanged(changedLineIds.length);
    // 처음 한 번만 연다 — 그 뒤의 초안 변경은 이 화면이 낸 것이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.ready]);

  // 보낸 확정의 결과를 러너에서 본다 — 결과를 모르게 되면(uncertain) 잠금은 두고 F10 을 다시 받는다.
  // 다른 곳(처리 내역 확인)에서 결과가 나면 같은 키로 불러 결과를 받는다(서버에 다시 가지 않는다)
  const sentKey = work?.sentBody ? work.key : null;
  useEffect(() => {
    if (!runtime || !sentKey) return;
    return runtime.runner.subscribe(() => {
      void runtime.store.get(sentKey).then((op) => {
        if (!mounted.current || workRef.current?.key !== sentKey || settled.current === sentKey) return;
        if (op?.status === 'uncertain' && phaseRef.current === 'sending') {
          release();
          signal('error');
        } else if ((op?.status === 'confirmed' || op?.status === 'rejected') && !busy()) {
          const body = workRef.current?.sentBody;
          if (body) void transmitRef.current(body, sentKey);
        }
      })
      // 작업 기록을 못 읽으면 그대로 둔다 — 다음 알림이나 F10 이 다시 본다
      .catch(() => {});
    });
    // 보낸 키가 바뀔 때만 다시 구독한다(처리기는 ref 로 최신을 본다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, sentKey, signal]);

  /** 칸을 바꾸는 입력 — 권한이 없거나 잠겼으면 오류음만 */
  const touch = (): boolean => {
    if (!workRef.current) return false;
    if (!canOperate || locked()) {
      signal('error');
      return false;
    }
    setAlert(null);
    setArmed(false);
    return true;
  };
  const remember = (before: BoxDraft) => {
    if (!undoRef.current) setUndo(before);
  };

  /** 지금 줄의 수량을 바꾼다 — 상한을 넘으면 오류음·그대로 */
  /** compute: 새 수량 · 'blank'(빈칸으로) · null(그대로) */
  const edit = (compute: (current: number | undefined) => number | 'blank' | null) => {
    if (!touch()) return;
    const before = workRef.current!;
    const row = rowsNow()[cursorRef.current];
    if (!row) return;
    const qty = compute(row.kind === 'line' ? before.cells[row.line.lineId]?.qty : row.item.qty);
    if (qty === null) return;
    // 리스트에 없던 물건의 «빈칸» 은 줄을 지우는 것이다(0 과 같다)
    const next =
      row.kind === 'line'
        ? qty === 'blank'
          ? clearLine(before, row.line.lineId)
          : setLineQty(before, row.line.lineId, qty)
        : setUnplannedQty(before, row.item.skuId, qty === 'blank' ? 0 : qty);
    if (next === before) {
      signal('error');
      return;
    }
    remember(before);
    void commit(next).catch(() => {});
    freshRef.current = false;
    // 리스트에 없던 물건을 0 으로 — 그 줄이 지워졌다
    if (qty === 'blank') freshRef.current = true;
    if (row.kind === 'unplanned' && (qty === 0 || qty === 'blank')) {
      setCursor(Math.max(0, Math.min(cursorRef.current, rowsNow().length - 1)));
      freshRef.current = true;
    }
  };
  const typeDigit = (digit: number) => edit((current) => (freshRef.current || current === undefined ? digit : current * 10 + digit));
  const typeRef = useRef(typeDigit);
  typeRef.current = typeDigit;
  const digitCommand = useCallback((digit: number) => typeRef.current(digit), []);
  useDigitCommands(picking ? null : digitCommand);

  const move = (delta: number) => {
    if (!workRef.current || busy()) return;
    setAlert(null);
    setArmed(false);
    moveTo(cursorRef.current + delta);
  };

  useHumanKeys(
    picking
      ? null
      : (key: string) => {
          if (/^\d$/.test(key)) typeDigit(Number(key));
          // 한 자리를 지우면 빈칸 — 센 0 이 아니다
          else if (key === 'Backspace') edit((current) => (current === undefined ? null : current < 10 ? 'blank' : Math.floor(current / 10)));
          else if (key === 'ArrowUp') move(-1);
          else if (key === 'ArrowDown' || key === 'Enter') move(1);
        }
  );

  /** 상품 바코드 — 이 상자의 그 SKU 줄에 +입수, 없으면 리스트에 없던 물건(주의음) */
  const onScan = (code: string) => {
    if (!workRef.current) return;
    if (!canOperate || locked()) {
      signal('error');
      return;
    }
    setPicking(false);
    lookup.mutateAsync(code).then(
      (skus) => {
        if (!mounted.current) return;
        const sku = skus[0];
        if (!sku) {
          setAlert({ message: '등록되지 않은 바코드예요', detail: code });
          signal('error');
          return;
        }
        if (!workRef.current || locked()) {
          signal('error');
          return;
        }
        const row = rowsNow()[cursorRef.current];
        const result = applyScan(workRef.current, boxRef.current, sku, scanIncrement(sku, code), row?.kind === 'line' ? row.line.lineId : null);
        if (result.rejected) {
          signal('error');
          return;
        }
        setAlert(null);
        setArmed(false);
        void commit(result.draft).catch(() => {});
        focusTarget(result.target);
        signal(result.target.kind === 'line' ? 'success' : 'attention');
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setAlert({ message: errorMessage(error, 'barcode'), detail: code });
        signal('error');
      }
    );
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(useCallback((event: { code: string }) => scanRef.current(event.code), []));

  /** F9 에서 고른 SKU — 그 SKU 줄이 있으면 그 줄에 +1, 없으면 리스트에 없던 물건. 다음 숫자는 그 줄을 덮어쓴다 */
  const pick = (sku: SelectedSku) => {
    setPicking(false);
    if (!touch()) return;
    const result = applyScan(workRef.current!, boxRef.current, sku, 1, null);
    if (result.rejected) {
      signal('error');
      return;
    }
    void commit(result.draft).catch(() => {});
    focusTarget(result.target);
  };

  const listAs = () => {
    if (!touch()) return;
    const before = workRef.current!;
    const row = rowsNow()[cursorRef.current];
    if (row?.kind !== 'line' || !canApplyList(row.line)) {
      signal('error');
      return;
    }
    remember(before);
    void commit(applyList(before, row.line)).catch(() => {});
    freshRef.current = true;
  };

  const confirm = () => {
    const current = workRef.current;
    if (!current || busy()) return;
    setPicking(false);
    if (current.sentBody) {
      setAlert(null);
      void transmit(current.sentBody, current.key);
      return;
    }
    if (!armed) {
      const block = confirmBlock(current, boxRef.current);
      if (block) {
        explain(block, current, boxRef.current);
        return;
      }
      setAlert(null);
      setArmed(true);
      return;
    }
    void recheckAndSend();
  };

  /** Esc — 검색 닫기 · 확인에서 돌아가기 · 그 칸 되돌림 · 대기(초안은 기기에 남는다) */
  const back = () => {
    if (busy()) return;
    if (picking) return setPicking(false);
    if (armed) return setArmed(false);
    const current = workRef.current;
    const before = undoRef.current;
    if (current && before && !current.sentBody) {
      void commit({ ...before, key: current.key, sentBody: current.sentBody }).catch(() => {});
      setUndo(null);
      freshRef.current = true;
      setAlert(null);
      return;
    }
    onBack();
  };

  const rows = work ? rowsOf(box.lines, work) : [];
  const index = Math.min(cursor, Math.max(rows.length - 1, 0));
  const active = rows[index];
  const idle = phase === 'idle';
  const open = idle && !!work && !work.sentBody;
  const blanks = work ? blankLineIds(work, box).length : 0;
  const actions: StationAction[] = [
    {
      ...INBOUND_BOX_ACTIONS.listAs,
      enabled: canOperate && open && !armed && !picking && active?.kind === 'line' && canApplyList(active.line),
      run: listAs,
    },
    { ...INBOUND_BOX_ACTIONS.unplanned, enabled: canOperate && open && !armed && !picking, run: () => touch() && setPicking(true) },
    {
      ...INBOUND_BOX_ACTIONS.confirm,
      label: work?.sentBody ? '다시 보내기' : blanks > 0 && !armed ? `확정 (빈칸 ${blanks})` : INBOUND_BOX_ACTIONS.confirm.label,
      enabled: canOperate && idle && !!work,
      run: confirm,
    },
    {
      ...INBOUND_BOX_ACTIONS.back,
      label: picking ? '닫기' : armed ? '돌아가기' : undo && !work?.sentBody ? '되돌림' : INBOUND_BOX_ACTIONS.back.label,
      enabled: idle,
      run: back,
    },
  ];
  useStationActions(actions);

  return (
    <section aria-label="상자 작업" className="flex h-full min-h-0 flex-col gap-3">
      <BoxHeader box={box} />
      <div className="min-h-0 flex-1">
        <WorkGrid
          left={
            <BoxWorkPanel
              loading={!work ? { error: saved.error } : null}
              picking={picking}
              onPick={pick}
              busy={!idle}
              uncertain={!!work?.sentBody}
              armed={armed}
              alert={alert}
              quantity={work && active ? quantityText(work, active) : null}
            />
          }
          right={
            !work ? null : armed ? (
              <BoxReview label={box.label} rows={reviewRows(work, box)} />
            ) : (
              <BoxGrid rows={rows} draft={work} cursor={index} />
            )
          }
        />
      </div>
    </section>
  );
}

function quantityText(draft: BoxDraft, row: BoxRow): string {
  if (row.kind === 'unplanned') return String(row.item.qty);
  const cell = draft.cells[row.line.lineId];
  return cell ? String(cell.qty) : '';
}

/** 그리는 값(state)과 같은 렌더 안의 다음 키가 볼 값(ref)을 함께 둔다 */
function useRefState<T>(initial: T): [T, { readonly current: T }, (next: T) => void] {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, ref, set];
}
