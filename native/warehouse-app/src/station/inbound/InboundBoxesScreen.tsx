import { useCallback, useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { listShipments, openBox } from '../../domains/inbound-shipment/api';
import type { BoxCandidate, BoxView, ReceiveBoxResult } from '../../domains/inbound-shipment/types';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { BigPanel } from '../outbound/panels';
import { ChooseShipmentForAdd } from './AddBoxFlow';
import { BoxHeader } from './BoxHeader';
import { BoxWork } from './BoxWork';
import { ChooseBox, WaitingForBox } from './BoxFinder';
import { DoneBox } from './DoneBox';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import { addableShipments, type InboundBoxesNotice, type InboundBoxesView } from './inboundBoxTypes';
import { ReceivedBox } from './ReceivedBox';

/** 입고내역의 선적 입고 줄이 바로 여는 상자 */
export interface InitialBox {
  shipmentId: string;
  boxId: string;
}

/** 스테이션 F3 선적 상자 입고 — 상자 이름으로 찾아 세고 확정한다(#1239) */
export function InboundBoxesScreen({ initial }: { initial?: InitialBox }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <InboundBoxes key={warehouseId} warehouseId={warehouseId} initial={initial} />;
}

const viewOf = (box: BoxView): InboundBoxesView =>
  box.disposition === 'forward' ? { kind: 'forward', box } : box.status === 'received' ? { kind: 'received', box } : { kind: 'work', box };

function InboundBoxes({ warehouseId, initial }: { warehouseId: string; initial?: InitialBox }) {
  const api = useApiClient();
  const { signal } = useFeedback();
  const permissions = useWorkPermissions();
  const canAddUnlisted = permissions.data?.inboundShipmentOperate === true;
  const [current, setCurrent] = useState<InboundBoxesView>({ kind: 'waiting' });
  const [notice, setNotice] = useState<InboundBoxesNotice | null>(null);
  // 상자를 읽는 중 — 겹친 열기(연속 Enter·스캔)는 버린다
  const opening = useRef(false);
  // 상자를 읽은 횟수 — 같은 상자를 다시 열면 작업 화면을 새로 마운트해 초안을 다시 맞춘다
  const [openCount, setOpenCount] = useState(0);

  const say = useCallback(
    (next: InboundBoxesNotice | null) => {
      setNotice(next);
      if (next?.tone === 'error') signal('error');
    },
    [signal]
  );

  const toWaiting = useCallback(
    (next: InboundBoxesNotice | null = null) => {
      setCurrent({ kind: 'waiting' });
      say(next);
    },
    [say]
  );

  /** 상자를 읽고 구분(전달용·확정됨·작업)대로 연다 */
  const open = useCallback(
    async (shipmentId: string, boxId: string) => {
      if (opening.current) return false;
      opening.current = true;
      try {
        const box = await openBox(api, shipmentId, boxId);
        say(null);
        setOpenCount((n) => n + 1);
        setCurrent(viewOf(box));
        return true;
      } catch (error) {
        say({ text: errorMessage(error), tone: 'error' });
      } finally {
        opening.current = false;
      }
      return false;
    },
    [api, say]
  );

  const openedInitial = useRef(false);
  useEffect(() => {
    if (!initial || openedInitial.current) return;
    openedInitial.current = true;
    void open(initial.shipmentId, initial.boxId);
  }, [initial, open]);

  const choose = useCallback((label: string, candidates: BoxCandidate[]) => setCurrent({ kind: 'choose', label, candidates }), []);
  // 리스트에 없는 상자로 받기(F12) — 열린 선적 + 저절로 끝난 지 30일 안의 선적에서 고른다(사람이 닫은 선적은 빠진다)
  const loadingShipments = useRef(false);
  const addUnlisted = useCallback(
    async (label: string) => {
      if (loadingShipments.current) return;
      loadingShipments.current = true;
      try {
        const shipments = addableShipments(await listShipments(api, warehouseId, ['expected', 'receiving', 'closed']), new Date());
        if (shipments.length === 0) say({ text: '상자를 더할 수 있는 선적이 없어요', tone: 'error' });
        else {
          say(null);
          setCurrent({ kind: 'chooseShipmentForAdd', label, shipments });
        }
      } catch (error) {
        say({ text: errorMessage(error), tone: 'error' });
      } finally {
        loadingShipments.current = false;
      }
    },
    [api, warehouseId, say]
  );
  const back = useCallback(() => toWaiting(), [toWaiting]);
  // 확정 — 끝(대기 위에 방금 상자, 다음 이름을 치기 전까지 F11 확정 취소)
  const done = useCallback(
    (box: BoxView, result: ReceiveBoxResult) => {
      say(null);
      setCurrent({ kind: 'done', box, result });
    },
    [say]
  );
  // 다음 상자 이름을 치기 시작하면 끝을 거둔다(확정 취소가 사라진다)
  const leaveDone = useCallback(() => setCurrent((now) => (now.kind === 'done' ? { kind: 'waiting' } : now)), []);
  /** 확정 취소가 됐다 — 다시 열린 상자를 작업 화면으로(새로 마운트해 빈칸에서) */
  const reopenedForWork = useCallback(
    (next: BoxView) => {
      say(null);
      setOpenCount((n) => n + 1);
      setCurrent(viewOf(next));
    },
    [say]
  );
  /** 끝에서 취소했는데 상자가 아직 확정돼 있다 — 새로 읽은 확정된 상자로 */
  const stillReceived = useCallback(
    (latest: BoxView, text: string) => {
      setCurrent(viewOf(latest));
      say({ text, tone: 'error' });
    },
    [say]
  );
  /** 상자를 다시 읽어 그 상태대로 연다 — 안내는 읽은 뒤에 띄운다(열기가 안내를 지운다) */
  const reopen = useCallback(
    async (box: BoxView, text?: string) => {
      const ok = await open(box.shipmentId, box.boxId);
      // 못 읽었으면 대기로 — 낡은 작업 화면에 남지 않는다(열기가 띄운 오류는 그대로)
      if (!ok) setCurrent({ kind: 'waiting' });
      else if (text) say({ text, tone: 'error' });
    },
    [open, say]
  );
  /** 더한 상자를 연다 — 못 읽으면 대기로(상자는 이미 있어 이름으로 찾으면 열린다) */
  const openAdded = useCallback(
    async (shipmentId: string, boxId: string) => {
      if (!(await open(shipmentId, boxId))) setCurrent({ kind: 'waiting' });
    },
    [open]
  );

  // 대기·고르기·상자 작업·확정된 상자·선적 고르기는 자기 층에서 Esc 를 선언한다 — 나머지(전달용·끝)는 여기서 대기로
  const ownsEsc = ['waiting', 'choose', 'work', 'received', 'chooseShipmentForAdd'];
  const elsewhere: StationAction[] = ownsEsc.includes(current.kind) ? [] : [{ ...INBOUND_BOX_ACTIONS.back, enabled: true, run: back }];
  useStationActions(elsewhere);

  let body;
  switch (current.kind) {
    case 'waiting':
    case 'done':
      // 끝은 대기 위에 방금 상자를 얹은 것 — 대기 칸은 같은 자리라 끝을 거둬도 친 이름이 남는다
      body = (
        <div className="flex h-full min-h-0 flex-col gap-3">
          {current.kind === 'done' ? (
            <DoneBox
              key={`${current.box.boxId}:${current.result.countIds.join(',')}`}
              box={current.box}
              result={current.result}
              onCanceled={reopenedForWork}
              onStillReceived={stillReceived}
            />
          ) : null}
          <WaitingForBox
            warehouseId={warehouseId}
            canAddUnlisted={canAddUnlisted}
            onOpen={open}
            onChoose={choose}
            onAddUnlisted={(label) => void addUnlisted(label)}
            onNextName={leaveDone}
            say={say}
          />
        </div>
      );
      break;
    case 'choose':
      body = <ChooseBox label={current.label} candidates={current.candidates} onOpen={open} onBack={back} />;
      break;
    case 'forward':
      body = (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <BoxHeader box={current.box} />
          <BigPanel
            content={{ kind: 'notice', title: '전달용 상자 — 재고로 받지 않아요', message: current.box.forwardNote ?? undefined }}
          />
        </div>
      );
      break;
    case 'chooseShipmentForAdd':
      body = (
        <ChooseShipmentForAdd
          label={current.label}
          shipments={current.shipments}
          onAdded={(shipmentId, boxId) => void openAdded(shipmentId, boxId)}
          onBack={back}
        />
      );
      break;
    case 'received':
      body = <ReceivedBox key={`${current.box.boxId}:${openCount}`} box={current.box} onCanceled={reopenedForWork} onBack={back} />;
      break;
    case 'work': {
      const box = current.box;
      body = (
        <BoxWork
          key={`${box.boxId}:${openCount}`}
          box={box}
          onDone={(result) => done(box, result)}
          onReopen={(text) => void reopen(box, text)}
          onBack={back}
        />
      );
      break;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="mb-2.5 shrink-0">
        <ScreenHeader title="선적 상자 입고" backTo="/inbound" description="상자 이름으로 찾아 수량을 세고 확정하세요." />
      </div>
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'shrink-0 rounded-xl px-4 py-3 text-lg font-semibold',
            notice.tone === 'error' ? 'bg-[#fcebe8] text-[#aa4037]' : 'bg-[#eff6ff] text-[#2563eb]'
          )}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
