import { useCallback, useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { openBox } from '../../domains/inbound-shipment/api';
import type { BoxCandidate, BoxView, ReceiveBoxResult } from '../../domains/inbound-shipment/types';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { BigPanel } from '../outbound/panels';
import { BoxHeader } from './BoxHeader';
import { BoxWork } from './BoxWork';
import { ChooseBox, WaitingForBox } from './BoxFinder';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import type { InboundBoxesNotice, InboundBoxesView } from './inboundBoxTypes';

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
  // 리스트에 없는 상자로 받기(F12) — 화면은 Task 12 가 잇는다
  const addUnlisted = useCallback(() => {}, []);
  const back = useCallback(() => toWaiting(), [toWaiting]);
  // 확정 — 끝 화면(Task 12)이 오기 전까지는 한 줄 안내와 함께 대기로
  const done = useCallback(
    (box: BoxView, result: ReceiveBoxResult) =>
      toWaiting({
        text: `${box.label} 확정 — 적치 대기로 갔어요${result.shipmentStatus === 'closed' ? ' · 이 선적의 상자를 다 받았어요' : ''}`,
        tone: 'info',
      }),
    [toWaiting]
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

  // 대기·고르기·상자 작업은 자기 층에서 Esc 를 선언한다 — 나머지 상태는 여기서 대기로
  const elsewhere: StationAction[] =
    current.kind === 'waiting' || current.kind === 'choose' || current.kind === 'work'
      ? []
      : [{ ...INBOUND_BOX_ACTIONS.back, enabled: true, run: back }];
  useStationActions(elsewhere);

  let body;
  switch (current.kind) {
    case 'waiting':
      body = (
        <WaitingForBox
          warehouseId={warehouseId}
          canAddUnlisted={canAddUnlisted}
          onOpen={open}
          onChoose={choose}
          onAddUnlisted={addUnlisted}
          say={say}
        />
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
      body = null;
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
    default:
      // received·done — 확정된 상자·끝(Task 12)이 이 자리를 채운다
      body = <BoxHeader box={current.box} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'shrink-0 rounded-[10px] px-4 py-3 text-lg font-semibold',
            notice.tone === 'error' ? 'bg-[#FDE8EA] text-[#9E1320]' : 'bg-[#E3ECFC] text-[#123E99]'
          )}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
