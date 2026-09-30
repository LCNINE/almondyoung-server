import type { ShipmentByWaybill } from './types';
import type { LabelItemChange } from './waybillLabel';
import { SHIPMENT_WITHDRAWN_MESSAGE, WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';

export type LabelGateDecision =
  | { kind: 'open' }
  | { kind: 'print'; message: string; changes: LabelItemChange[] }
  | { kind: 'withdraw' }
  | { kind: 'blocked'; message: string };

/**
 * 송장 스캔 결과 → 화면(스펙 §10.5). 서버의 전진 명령도 같은 조건으로 막으므로(I5) 이건 헛걸음 방지다 —
 * 작업 화면에 들어가 첫 스캔에서 거절당하기 전에 입구에서 알려 준다.
 */
export function labelGateOf(
  found: Pick<ShipmentByWaybill, 'labelState' | 'labelChanges' | 'labelIssue'>,
  canPrint: boolean,
): LabelGateDecision {
  switch (found.labelState) {
    case 'never_printed':
      return canPrint
        ? { kind: 'print', message: '송장을 아직 출력하지 않았어요. 출력한 뒤 송장을 다시 스캔해 주세요.', changes: [] }
        : { kind: 'blocked', message: '송장을 아직 출력하지 않았어요. 프린터 있는 자리에서 출력해 주세요.' };
    case 'reprint_required':
      return canPrint
        ? { kind: 'print', message: '송장이 바뀌었어요. 새 송장을 출력하고 옛 송장은 버려 주세요.', changes: found.labelChanges }
        : { kind: 'blocked', message: '송장이 바뀌었어요. 프린터 있는 자리에서 새 송장을 출력해 주세요.' };
    case 'not_started':
      return { kind: 'blocked', message: '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.' };
    case 'withdrawing':
      return { kind: 'withdraw' };
    case 'withdrawn':
      return { kind: 'blocked', message: SHIPMENT_WITHDRAWN_MESSAGE };
    case 'unavailable':
      return {
        kind: 'blocked',
        message: found.labelIssue === 'WAYBILL_STALE' ? WAYBILL_STALE_MESSAGE : '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.',
      };
    default:
      return { kind: 'open' };
  }
}
