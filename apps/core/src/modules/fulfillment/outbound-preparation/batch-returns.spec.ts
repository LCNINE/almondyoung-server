import { readFileSync } from 'fs';
import { join } from 'path';
import { BATCH_EXIT_REASONS, batchExitReasonOf } from './batch-returns';

const repo = join(__dirname, '../../../../../..');
const source = (path: string) => readFileSync(join(repo, path), 'utf8');

describe('batchExitReasonOf', () => {
  it.each([
    ['station_withdraw_command', { place: '물류앱 출고 검수', reason: '박스 빼기' }],
    ['short_pick:inventory_shortage', { place: '물류앱 피킹', reason: '결품 — 재고 부족' }],
    ['short_pick:unknown_code', { place: '물류앱 피킹', reason: '결품 — unknown_code' }],
    ['작업 시작 전 뺌 — 송장 미발급·재발급 필요', { place: '물류앱 작업 시작', reason: '송장 미발급·재발급 필요' }],
    ['잘못 넣은 상자', { place: '관리자 출고 배치', reason: '잘못 넣은 상자' }],
    ['부분 취소로 뺌', { place: '관리자 출고 배치', reason: '부분 취소로 뺌' }],
    ['합포장', { place: '관리자 합포장', reason: '합포장' }],
    ['  고객 요청으로 보류 ', { place: null, reason: '고객 요청으로 보류' }],
  ])('%s', (stored, expected) => {
    expect(batchExitReasonOf(stored)).toEqual(expected);
  });
});

// 뺀 곳은 앱이 남기는 고정 사유로만 안다 — 앱이 문구를 바꾸면 여기서 알린다
describe('batch exit reasons sent by the apps', () => {
  it.each([
    ['native/warehouse-app/src/station/outbound/useInspectionBox.ts', `'${BATCH_EXIT_REASONS.stationWithdraw}'`],
    ['native/warehouse-app/src/domains/outbound/batchStart.ts', `\`${BATCH_EXIT_REASONS.beforeStartPrefix}\${`],
    [
      'apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx',
      `WRONG_BOX_EXIT_REASON = '${BATCH_EXIT_REASONS.wrongBox}'`,
    ],
    [
      'apps/admin-web/src/features/order/outbound-batches/components/batch-detail-drawer/index.tsx',
      `CANCEL_WAITING_EXIT_REASON = '${BATCH_EXIT_REASONS.cancelWaiting}'`,
    ],
    [
      'apps/admin-web/src/features/order/fulfillments/detail/consolidation-progress-panel.tsx',
      `EXCLUDE_REASON = '${BATCH_EXIT_REASONS.consolidation}'`,
    ],
    [
      'apps/admin-web/src/features/order/fulfillments/detail/consolidation-sheet.tsx',
      `reason: '${BATCH_EXIT_REASONS.consolidation}'`,
    ],
    [
      'apps/core/src/modules/fulfillment/services/short-pick-exit.service.ts',
      `\`${BATCH_EXIT_REASONS.shortPickPrefix}\${`,
    ],
  ])('%s', (path, literal) => {
    expect(source(path)).toContain(literal);
  });
});
