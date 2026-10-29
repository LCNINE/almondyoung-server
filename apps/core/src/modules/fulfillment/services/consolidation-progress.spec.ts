import { ShipmentOperationStatus } from '../dto/consolidation.dto';
import {
  buildConsolidationProgressResponse,
  buildConsolidationProgressSources,
  ProgressMemberRow,
} from './consolidation-progress';

const empty = { blockers: [], workItems: [], waybills: [], reconcileStates: [] };

describe('buildConsolidationProgressSources', () => {
  it('원본마다 막힘·작업 항목·송장·리컨실러 상태를 붙인다', () => {
    const gaveUpAt = new Date('2026-10-29T01:00:00.000Z');
    const nextCheckAt = new Date('2026-10-29T02:00:00.000Z');
    const result = buildConsolidationProgressSources({
      sourceIds: ['a', 'b'],
      blockers: [{ shipmentId: 'a', codes: ['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM'] }],
      workItems: [{ shipmentId: 'a', batchId: 'batch-1', status: 'withdrawing' }],
      waybills: [{ shipmentId: 'a', id: 'wb-1', status: 'registered', trackingNo: 'T-1' }],
      reconcileStates: [{ shipmentId: 'a', gaveUpAt, nextCheckAt }],
    });
    expect(result).toEqual([
      {
        shipmentId: 'a',
        trackingNo: 'T-1',
        batchId: 'batch-1',
        workItemStatus: 'withdrawing',
        waybillId: 'wb-1',
        waybillStatus: 'registered',
        blockers: ['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM'],
        gaveUpAt: '2026-10-29T01:00:00.000Z',
        nextCheckAt: '2026-10-29T02:00:00.000Z',
      },
      {
        shipmentId: 'b',
        trackingNo: null,
        batchId: null,
        workItemStatus: null,
        waybillId: null,
        waybillStatus: null,
        blockers: [],
        gaveUpAt: null,
        nextCheckAt: null,
      },
    ]);
  });

  it('같은 원본의 행이 여럿이면 앞(가장 최근) 것을 쓴다', () => {
    const [source] = buildConsolidationProgressSources({
      ...empty,
      sourceIds: ['a'],
      workItems: [
        { shipmentId: 'a', batchId: 'new', status: 'picking' },
        { shipmentId: 'a', batchId: 'old', status: 'queued' },
      ],
      waybills: [
        { shipmentId: 'a', id: 'wb-new', status: 'allocated', trackingNo: null },
        { shipmentId: 'a', id: 'wb-old', status: 'registered', trackingNo: 'T-old' },
      ],
    });
    expect(source).toMatchObject({ batchId: 'new', workItemStatus: 'picking', waybillId: 'wb-new', trackingNo: null });
  });

  it('포기 전이면 gaveUpAt 은 null 이고 다음 재확인 시각만 준다', () => {
    const [source] = buildConsolidationProgressSources({
      ...empty,
      sourceIds: ['a'],
      reconcileStates: [{ shipmentId: 'a', gaveUpAt: null, nextCheckAt: new Date('2026-10-29T03:00:00.000Z') }],
    });
    expect(source).toMatchObject({ gaveUpAt: null, nextCheckAt: '2026-10-29T03:00:00.000Z' });
  });

  it('원본이 아닌 상자의 행은 무시하고, 같은 원본의 막힘이 나뉘어 와도 합친다', () => {
    const result = buildConsolidationProgressSources({
      ...empty,
      sourceIds: ['a'],
      blockers: [
        { shipmentId: 'a', codes: ['ACTIVE_INVOICE'] },
        { shipmentId: 'a', codes: ['CUSTODY_REQUIRES_UNPICK', 'ACTIVE_INVOICE'] },
        { shipmentId: 'x', codes: ['ACTIVE_WORK_ITEM'] },
      ],
      workItems: [{ shipmentId: 'x', batchId: 'batch-x', status: 'queued' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ blockers: ['ACTIVE_INVOICE', 'CUSTODY_REQUIRES_UNPICK'], batchId: null });
  });
});

describe('buildConsolidationProgressResponse', () => {
  const members: ProgressMemberRow[] = [
    { shipmentId: 'b', role: 'source' },
    { shipmentId: 't', role: 'target' },
    { shipmentId: 'a', role: 'source' },
  ];
  const notCompleted: ShipmentOperationStatus[] = ['failed', 'recovery_required', 'pending'];

  it('완료면 target 멤버를 새 상자로 돌려주고 원본은 정렬해 둔다', () => {
    const result = buildConsolidationProgressResponse({
      ...empty,
      operation: { id: 'op', status: 'completed' },
      members,
    });
    expect(result).toMatchObject({ operationId: 'op', status: 'completed', targetShipmentId: 't' });
    expect(result.sources.map((s) => s.shipmentId)).toEqual(['a', 'b']);
  });

  it.each(notCompleted)('%s 는 실제 상태를 그대로 쓰고 새 상자는 null 이다', (status) => {
    const result = buildConsolidationProgressResponse({
      ...empty,
      operation: { id: 'op', status },
      members,
      blockers: [{ shipmentId: 'a', codes: ['ACTIVE_INVOICE'] }],
    });
    expect(result).toMatchObject({ status, targetShipmentId: null });
    expect(result.sources.map((s) => [s.shipmentId, s.blockers])).toEqual([
      ['a', ['ACTIVE_INVOICE']],
      ['b', []],
    ]);
  });
});
