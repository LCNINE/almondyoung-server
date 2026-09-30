import type { ApiClient } from '../../core/data/httpClient';
import { errorMessage, WAYBILL_NOT_DISPATCHABLE_MESSAGE, WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';
import type { PrintRaw } from '../../core/hardware/print/labelPrinter';
import { blockersOf, groupBlockers, type BlockerGroup, type BlockerText } from './batchStart';
import { confirmLabelPrinted, fetchWaybillLabel, labelErrorMessage, printOneLabel } from './waybillLabel';

/** core `JoinCandidateResponseDto` 와 같은 모양(dto/outbound-batch-v2.dto.ts). */
export interface JoinCandidate {
  shipmentId: string;
  shipmentStatus: string;
  manifestVersion: number;
  orderNos: string[];
  recipientMasked: string;
  totalQty: number;
  lines: Array<{ skuCode: string; skuName: string; qty: number }>;
  waybill: { id: string; trackingNo: string | null; status: string; source: string; carrier: string; printable: boolean } | null;
  issue: string | null;
  waybillIssue: string | null;
}

export function fetchJoinCandidates(api: ApiClient, batchId: string, code: string): Promise<JoinCandidate[]> {
  const qs = new URLSearchParams({ code: code.trim() });
  return api.request<JoinCandidate[]>({ path: `/outbound-batches/${batchId}/join-candidates?${qs.toString()}` });
}

export const JOIN_BLOCKER_TEXT: BlockerText = {
  INBOUND_PENDING: { title: '적치 대기 중인 상품', guidance: '적치를 끝낸 뒤 다시 넣어 주세요.' },
  STOCK_SHORT: { title: '재고 부족', guidance: '재고가 모자라 이 배치에 넣을 수 없어요. 관리자에게 문의해 주세요.' },
  WAYBILL_NOT_READY: { title: '송장 재발급 필요', guidance: '관리자에게 송장 재발급을 요청한 뒤 다시 넣어 주세요.' },
};

/** 후보 조회가 «이 박스는 이미 이 배치에 들어 있다» 를 알리는 코드(core `findJoinCandidates`). 막는 사유가 아니다. */
export const ALREADY_IN_THIS_BATCH = 'ALREADY_IN_THIS_BATCH';

const ISSUE_TEXT: Record<string, string> = {
  SHIPMENT_ACTIVE_WORK_ITEM: '이미 다른 배치에 들어 있는 박스예요.',
  SHIPMENT_NOT_PLANNED: '출고 계획이 끝나지 않았거나 이미 출고된 박스예요.',
  SHIPMENT_NOT_FULLY_RESERVED: '재고 예약이 끝나지 않은 박스예요. 관리자에게 문의해 주세요.',
  SHIPMENT_NOT_FULLY_RESERVED_PHYSICAL: '재고 예약이 끝나지 않은 박스예요. 관리자에게 문의해 주세요.',
  SHIPMENT_DISPATCH_EXISTS: '이미 출고 처리된 박스예요.',
  SHIPMENT_WITHDRAWING: '빼는 중인 박스예요. 뺄 상품을 바구니에 다 넣은 뒤 다시 넣어 주세요.',
};
const WAYBILL_ISSUE_TEXT: Record<string, string> = {
  WAYBILL_STALE: WAYBILL_STALE_MESSAGE,
  WAYBILL_NOT_DISPATCHABLE: WAYBILL_NOT_DISPATCHABLE_MESSAGE,
};

export type JoinOutcome =
  | { kind: 'blocked'; message: string }
  | { kind: 'join_blocked'; groups: BlockerGroup[] }
  | {
      kind: 'joined';
      shipmentId: string;
      print: 'printed' | 'external' | 'no_printer' | 'failed';
      message: string;
    };

export interface JoinDeps {
  api: ApiClient;
  print: PrintRaw;
  /** 이 기기의 송장 프린터. 없거나 출력 기능이 꺼진 기기면 null. */
  printer: string | null;
  newKey: () => string;
}

/**
 * 「이 배치에 넣기」 한 동작(스펙 §7, E9): 송장이 없으면 한진으로 발급 → 합류 → 출력. 출력은 합류가 성공한 뒤에만 한다 —
 * 합류 전의 종이는 로케이션이 없다(I4). 발급된 송장은 합류가 막혀도 그대로 남아 다음 시도에 쓰인다.
 */
export async function joinBoxIntoBatch(deps: JoinDeps, batchId: string, candidate: JoinCandidate): Promise<JoinOutcome> {
  // 이미 이 배치에 들어 있다 — 합류는 됐는데 응답을 잃은 재시도다. 발급·합류를 건너뛰고 출력으로 간다(송장은 합류 뒤라
  // 로케이션이 찍혀 있다).
  if (candidate.issue === ALREADY_IN_THIS_BATCH) {
    return printAfterJoin(deps, candidate.shipmentId, candidate.waybill?.printable ?? false, '이미 이 배치에 들어 있어요.');
  }
  if (candidate.issue) {
    return { kind: 'blocked', message: ISSUE_TEXT[candidate.issue] ?? `이 박스는 넣을 수 없어요 — 관리자에게 문의해 주세요 (${candidate.issue})` };
  }
  if (candidate.waybill && candidate.waybillIssue) {
    return {
      kind: 'blocked',
      message: WAYBILL_ISSUE_TEXT[candidate.waybillIssue] ?? '송장을 쓸 수 없는 상태예요. 관리자에게 송장 상태를 확인해 달라고 해 주세요.',
    };
  }
  let printable = candidate.waybill?.printable ?? false;
  if (!candidate.waybill) {
    try {
      const issued = await deps.api.request<{ status: string; source: string; carrier: string }>({
        method: 'POST',
        path: `/shipments/${candidate.shipmentId}/waybills`,
        body: { carrier: 'HANJIN', expectedManifestVersion: candidate.manifestVersion },
        idempotencyKey: deps.newKey(),
      });
      if (issued.status !== 'registered') {
        return { kind: 'blocked', message: '송장 발급이 끝나지 않았어요(한진 응답 대기·실패). 잠시 뒤 다시 시도하거나 관리자에게 문의해 주세요.' };
      }
      printable = issued.source === 'carrier' && issued.carrier === 'HANJIN';
    } catch (error) {
      return { kind: 'blocked', message: errorMessage(error, 'outbound') };
    }
  }
  try {
    await deps.api.request({
      method: 'POST',
      path: `/outbound-batches/${batchId}/shipments/${candidate.shipmentId}`,
      idempotencyKey: deps.newKey(),
    });
  } catch (error) {
    const blockers = blockersOf(error, 'BATCH_JOIN_BLOCKED');
    if (blockers) return { kind: 'join_blocked', groups: groupBlockers(blockers, JOIN_BLOCKER_TEXT) };
    return { kind: 'blocked', message: errorMessage(error, 'outbound') };
  }
  return printAfterJoin(deps, candidate.shipmentId, printable, '배치에 넣었어요.');
}

/** 합류가 끝난 박스의 송장 출력. 결과 문구는 `lead`(방금 넣었나, 이미 들어 있었나)로 시작한다. */
async function printAfterJoin(deps: JoinDeps, shipmentId: string, printable: boolean, lead: string): Promise<JoinOutcome> {
  const joined = { kind: 'joined' as const, shipmentId };
  if (!printable) return { ...joined, print: 'external', message: `${lead} 수기 송장 박스라 출력 없이 진행해요.` };
  if (!deps.printer) {
    return {
      ...joined,
      print: 'no_printer',
      message: `${lead} 이 PC 에는 송장 프린터가 없어요 — 프린터 있는 자리에서 송장을 출력해야 피킹할 수 있어요.`,
    };
  }
  try {
    const label = await printOneLabel(
      {
        fetchLabel: (id) => fetchWaybillLabel(deps.api, id),
        confirm: (id, fingerprint) => confirmLabelPrinted(deps.api, id, fingerprint),
        print: deps.print,
        target: deps.printer,
      },
      shipmentId,
    );
    return { ...joined, print: 'printed', message: `${lead} 송장을 출력했어요 (${label.trackingNo}). 이 송장으로 작업하세요.` };
  } catch (error) {
    return { ...joined, print: 'failed', message: `${lead} 송장 출력은 실패했어요: ${labelErrorMessage(error)} 아래에서 다시 출력해 주세요.` };
  }
}
