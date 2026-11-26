import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { cn } from '../../core/design/cn';
import { addBox } from '../../domains/inbound-shipment/api';
import type { ShipmentSummary } from '../../domains/inbound-shipment/types';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import { arrivalText } from './inboundBoxTypes';
import { PickList } from './PickList';
import { useKeyedWrite } from './useKeyedWrite';

const ADD_UNCERTAIN = '결과를 확인하지 못했어요 — F12 다시 보내기';
const ADD_CONFLICT = '이 선적에는 이 상자를 더할 수 없어요';

/**
 * 리스트에 없는 상자로 받기(스펙 §5.7) — 선적을 고르면 그 선적에 상자를 더하고 받은 상자를 연다.
 * 선적이 하나뿐이어도 고르게 한다(이름이 틀렸을 가능성이 커서 작업자의 명시적 행동이어야 한다). 기본 선택 없음.
 * 저절로 끝난 선적엔 «끝남». 멱등 키는 «선적 id + 친 이름» 초안에 둔다 — 결과를 모른 채 대기로 갔다가 같은 이름·같은
 * 선적으로 다시 F12 하면 같은 키로 다시 보낸다.
 */
export function ChooseShipmentForAdd({
  label,
  shipments,
  onAdded,
  onBack,
}: {
  label: string;
  shipments: ShipmentSummary[];
  onAdded(shipmentId: string, boxId: string): void;
  onBack(): void;
}) {
  const [picked, setPicked] = useState<{ shipment: ShipmentSummary; attempt: number } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const attempts = useRef(0);
  const pick = useCallback((shipment: ShipmentSummary) => {
    setAlert(null);
    setPicked({ shipment, attempt: ++attempts.current });
  }, []);
  useStationActions([{ ...INBOUND_BOX_ACTIONS.back, enabled: true, run: onBack }]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-[#e4e4e7] bg-white p-6">
      <p className="text-xl font-semibold">{`${label} — 리스트에 없는 상자를 더할 선적을 고르세요`}</p>
      <PickList
        label="선적 고르기"
        items={shipments}
        itemKey={(s) => s.id}
        onPick={pick}
        disabled={picked !== null}
        render={(s) => (
          <span className="flex items-center gap-3">
            <span className="text-lg font-semibold">{`${s.name}${arrivalText(s.expectedArrival)}`}</span>
            {s.status === 'closed' ? (
              <span className="rounded-[5px] bg-[#eff1f2] px-2 py-[5px] text-xs font-semibold whitespace-nowrap text-[#68706d]">끝남</span>
            ) : null}
          </span>
        )}
      />
      {picked ? (
        <AddingBox
          key={`${picked.shipment.id}:${picked.attempt}`}
          shipmentId={picked.shipment.id}
          label={label}
          onAdded={onAdded}
          onRejected={(text) => {
            setPicked(null);
            setAlert(text);
          }}
          onBack={onBack}
        />
      ) : alert ? (
        <StatusLine tone="alert" text={alert} />
      ) : null}
    </div>
  );
}

/** 고른 선적에 상자를 더한다 — 열리면 바로 보낸다(초안에 남은 키가 있으면 그 키로) */
function AddingBox({
  shipmentId,
  label,
  onAdded,
  onRejected,
  onBack,
}: {
  shipmentId: string;
  label: string;
  onAdded(shipmentId: string, boxId: string): void;
  onRejected(text: string): void;
  onBack(): void;
}) {
  const api = useApiClient();
  const write = useKeyedWrite({
    draftKey: `inbound-box-add:${shipmentId}:${label}`,
    send: (key) => addBox(api, shipmentId, label, key),
    onConfirmed: async (result) => () => onAdded(shipmentId, result.boxId),
    onRejected: (error) =>
      onRejected(error instanceof ApiError && error.status === 409 ? ADD_CONFLICT : errorMessage(error)),
  });

  const started = useRef(false);
  useEffect(() => {
    if (!write.ready || started.current) return;
    started.current = true;
    void write.send();
  }, [write]);

  const actions: StationAction[] = [
    ...(write.uncertain || write.unsaved || write.blocked
      ? [{ ...INBOUND_BOX_ACTIONS.addUnlisted, label: '다시 보내기', enabled: true, run: () => void write.send() }]
      : []),
    { ...INBOUND_BOX_ACTIONS.back, enabled: !write.sending, run: onBack },
  ];
  useStationActions(actions);

  if (write.loadError) return <StatusLine tone="alert" text={errorMessage(write.loadError)} />;
  if (write.uncertain) return <StatusLine tone="alert" text={ADD_UNCERTAIN} />;
  if (write.unsaved) return <StatusLine tone="alert" text="기기에 저장하지 못했어요 — F12 를 다시 눌러 주세요" />;
  if (write.blocked) return <StatusLine tone="alert" text={write.blocked} />;
  return <StatusLine tone="notice" text="상자를 더하고 있어요" />;
}

function StatusLine({ tone, text }: { tone: 'alert' | 'notice'; text: string }) {
  return (
    <p
      role={tone === 'alert' ? 'alert' : 'status'}
      className={cn('shrink-0 text-lg font-semibold', tone === 'alert' ? 'text-[#aa4037]' : 'text-[#5E3B00]')}
    >
      {text}
    </p>
  );
}
