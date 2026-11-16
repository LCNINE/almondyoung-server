import { useState } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import type { BoxDraft } from '../../domains/inbound-shipment/boxDraft';
import { cancelBoxReceipt, openBox } from '../../domains/inbound-shipment/api';
import type { BoxView } from '../../domains/inbound-shipment/types';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import { useKeyedWrite } from './useKeyedWrite';

export const CANCEL_ARMED = '한 번 더 누르면 취소';
export const CANCEL_UNCERTAIN = '결과를 확인하지 못했어요 — F11 다시 보내기';
const STILL_RECEIVED = '상자가 아직 확정돼 있어요 — 확정 내용을 다시 확인해 주세요';
const CANCEL_CONFLICT = '확정을 취소할 수 없는 상자예요';

/**
 * 확정 취소 키의 초안 이름 — 그 확정이 만든 집계 id 중 가장 작은 것(스펙 §6).
 * 회차 id 는 쓰지 않는다: 0·자유 줄만 있는 상자는 회차가 없어(`receiptId = null`) 확정→취소→재확정→취소에서
 * 두 번째 취소가 첫 취소의 키로 나가고, 서버 멱등이 옛 응답을 돌려줘 취소가 안 됐는데 성공으로 보인다.
 * 상자를 열면 집계는 (만든 때, id) 순이라 한 확정의 집계는 id 순 — `counts[0].id` 가 이 값과 같다.
 */
export function cancelDraftKey(boxId: string, countIds: readonly string[]): string | null {
  if (countIds.length === 0) return null;
  const first = [...countIds].sort()[0];
  return `inbound-box-cancel:${boxId}:${first}`;
}

/**
 * 확정 취소(F11 두 번) — 확정된 상자 화면과 «끝» 이 같이 쓴다. 당일·전량·적치 전 같은 규칙은 서버가 판정한다.
 * 성공하면 상자를 다시 읽어 열려 있으면 그 상자로 `onCanceled`(작업 화면이 빈칸에서 다시 시작한다 —
 * 그 상자의 옛 작업 초안도 버린다), 아직 확정돼 있으면 `onStillReceived`.
 */
export function useBoxCancel({
  box,
  countIds,
  onCanceled,
  onStillReceived,
}: {
  box: BoxView;
  countIds: readonly string[];
  onCanceled(next: BoxView): void;
  onStillReceived(latest: BoxView, notice: string): void;
}) {
  const api = useApiClient();
  const { signal } = useFeedback();
  const permissions = useWorkPermissions();
  const canOperate = permissions.data?.inboundShipmentOperate === true;
  const draftKey = cancelDraftKey(box.boxId, countIds);
  const workDraft = useWorkDraft<BoxDraft | null>(`inbound-box:${box.boxId}`, null);
  const [armed, setArmed] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const reopened = async (latest: BoxView) => {
    await workDraft.update(() => null).catch(() => {});
    onCanceled(latest);
  };

  const write = useKeyedWrite({
    // 집계가 없는 상자는 취소할 수 없다(키는 쓰이지 않는다)
    draftKey: draftKey ?? `inbound-box-cancel:${box.boxId}:-`,
    send: (key) => cancelBoxReceipt(api, box.shipmentId, box.boxId, key),
    onConfirmed: async () => {
      let latest: BoxView;
      try {
        latest = await openBox(api, box.shipmentId, box.boxId);
      } catch {
        signal('error');
        return false;
      }
      if (latest.status === 'open') return () => void reopened(latest);
      return () => {
        signal('error');
        onStillReceived(latest, STILL_RECEIVED);
      };
    },
    onRejected: async (error) => {
      // 409 — 다른 곳에서 먼저 취소했으면 상자가 열려 있다
      if (error instanceof ApiError && error.status === 409) {
        const latest = await openBox(api, box.shipmentId, box.boxId).catch(() => null);
        if (latest?.status === 'open') {
          await reopened(latest);
          return;
        }
        setAlert(CANCEL_CONFLICT);
      } else {
        // 당일 아님·적치 시작은 서버가 400 으로 낸다(러너는 서버 본문을 들고 오지 않는다) — 입고 취소 문맥 문구
        setAlert(errorMessage(error, 'inbound-cancel'));
      }
      signal('error');
    },
  });

  const available = canOperate && draftKey !== null;
  const press = () => {
    if (!available || !write.ready || write.sending) return;
    setAlert(null);
    if (write.uncertain) {
      void write.send();
      return;
    }
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void write.send();
  };

  const action: StationAction = {
    ...INBOUND_BOX_ACTIONS.cancelReceipt,
    label: write.uncertain ? '다시 보내기' : INBOUND_BOX_ACTIONS.cancelReceipt.label,
    enabled: available && write.ready && !write.sending,
    run: press,
  };

  /** 지금 보일 한 줄 — 없으면 null */
  const status: { tone: 'notice' | 'alert'; text: string } | null = !available
    ? null
    : write.sending
      ? { tone: 'notice', text: '확정을 취소하고 있어요' }
      : write.uncertain
        ? { tone: 'alert', text: CANCEL_UNCERTAIN }
        : armed
          ? { tone: 'notice', text: CANCEL_ARMED }
          : write.unsaved
            ? { tone: 'alert', text: '기기에 저장하지 못했어요 — F11 을 다시 눌러 주세요' }
            : write.blocked
              ? { tone: 'alert', text: write.blocked }
              : alert
                ? { tone: 'alert', text: alert }
                : null;

  return {
    /** 기능키 바에 올릴 F11 — 권한이 없거나 집계가 없으면 null */
    action: available ? action : null,
    armed,
    disarm: () => setArmed(false),
    status,
  };
}
