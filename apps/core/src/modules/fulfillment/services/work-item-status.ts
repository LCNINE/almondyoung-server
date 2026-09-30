import { outboundBatchWorkItemStatusEnum, outboundWorkItemExitToEnum } from '../../inventory/schema/inventory.schema';

export type WorkItemStatus = (typeof outboundBatchWorkItemStatusEnum.enumValues)[number];
export type WorkItemExitTo = (typeof outboundWorkItemExitToEnum.enumValues)[number];

/**
 * 활성 작업 항목 — 박스당 하나(`uq_outbound_work_item_active_shipment`: completed·excluded 가 아닌 전부).
 * 파일마다 목록을 따로 두면 새 상태(withdrawing)를 하나 빠뜨리는 순간 그 경로만 «작업 없음» 으로 조용히 읽는다.
 */
export const ACTIVE_WORK_ITEM_STATUSES = [
  'queued',
  'picking',
  'ready_to_pack',
  'packing',
  'short_pick_recovery',
  'withdrawing',
] as const satisfies readonly WorkItemStatus[];

/** 이탈을 시작할 수 있는 상태(스펙 §8). 결품 격리·이탈 중은 제외. */
export const WITHDRAWABLE_WORK_ITEM_STATUSES = [
  'queued',
  'picking',
  'ready_to_pack',
  'packing',
] as const satisfies readonly WorkItemStatus[];
