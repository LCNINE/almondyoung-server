import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  customerReturnKindEnum,
  customerReturnStatusEnum,
  fulfillmentOrderCreationBacklogStatusEnum,
  outboundBatchWorkItemStatusEnum,
  shipmentStatusEnum,
  waybillStatusEnum,
} from '../../inventory/schema/inventory.schema';
import { judgedRowsSql } from './order-progress.judge-sql';
import {
  ORDER_PROGRESS_STAGES,
  ORDER_PROGRESS_STATES,
  OrderProgressStage,
  SHIPMENT_STAGES,
  SHIPMENT_STATES,
  STUCK_AFTER_MS,
  SETTLE_DELAYED_AFTER_MS,
  addBusinessDaysKst,
  isStuck,
  settlementDeadline,
  stuckAfterMs,
  stuckCutoff,
} from './order-progress.thresholds';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('order-progress thresholds', () => {
  it('스펙 §6 표의 기준을 그대로 갖는다', () => {
    expect(STUCK_AFTER_MS).toEqual({
      accept: HOUR,
      fo: DAY,
      reserve: 3 * DAY,
      plan: DAY,
      waybill: HOUR,
      pick: 12 * HOUR,
      dispatch: HOUR,
      track: 5 * DAY,
      cancel_request: 5 * 60_000,
      cancel: HOUR,
      return_exchange: 7 * DAY,
      unclassified: 0,
    });
  });

  it('모든 단계에 기준이 있다', () => {
    for (const stage of ORDER_PROGRESS_STAGES) expect(typeof STUCK_AFTER_MS[stage]).toBe('number');
  });

  it('기준을 «넘겨야» 갇힘이다 — 같으면 아니다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('accept', new Date(now.getTime() - HOUR), now)).toBe(false);
    expect(isStuck('accept', new Date(now.getTime() - HOUR - 1), now)).toBe(true);
  });

  it('unclassified 는 들어온 순간부터 갇힘이다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('unclassified', new Date(now.getTime() - 1), now)).toBe(true);
  });

  it('stuckCutoff 는 now − 기준', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(stuckCutoff('fo', now).toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });
});

describe('세부 상태별 갇힘(#1016 36번 재설계 D6)', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('정산 중은 며칠이 지나도 갇히지 않는다 — 30분 넘으면 판정이 settle_delayed 로 바꾼다', () => {
    expect(stuckAfterMs('cancel_request', 'settle_in_progress')).toBeNull();
    expect(isStuck('cancel_request', ago(3 * DAY), now, 'settle_in_progress')).toBe(false);
  });

  it('환불 지연·거절은 들어온 순간 갇힘', () => {
    expect(isStuck('cancel_request', ago(1), now, 'settle_delayed')).toBe(true);
    expect(isStuck('cancel_request', ago(1), now, 'settle_refused')).toBe(true);
  });

  it('입점사 «못 보냄»은 보고 즉시 갇힘 — dispatch 단계 기준(1시간)을 덮는다(K3 PR4)', () => {
    expect(stuckAfterMs('dispatch', 'drop_ship_unfulfillable')).toBe(0);
    expect(isStuck('dispatch', ago(1), now, 'drop_ship_unfulfillable')).toBe(true);
    expect(isStuck('dispatch', ago(1), now, 'drop_ship_pending')).toBe(false);
  });

  it('세부 상태가 없거나 덮어쓰기가 없으면 단계 기준', () => {
    expect(stuckAfterMs('fo', null)).toBe(DAY);
    expect(stuckAfterMs('fo', 'awaiting_matching')).toBe(DAY);
  });

  it('36번 규칙의 칸이 어휘에 있다', () => {
    expect(ORDER_PROGRESS_STATES.cancel_request).toEqual(['settle_in_progress', 'settle_delayed', 'settle_refused']);
  });
});

describe('ORDER_PROGRESS_STATES', () => {
  // 판정 SQL 의 본문. 리터럴 세부 상태는 여기에 따옴표째로 들어 있다
  const judgeText = new PgDialect().sqlToQuery(judgedRowsSql(sql`SELECT NULL::uuid`, '2000-01-01T00:00:00.000Z')).sql;
  // 판정 SQL 이 원천 값을 그대로(또는 접두어를 붙여) 내는 단계 — 그 단계의 세부 상태는 원천 enum 값이어야 한다
  const passthrough: Partial<Record<OrderProgressStage, readonly string[]>> = {
    fo: fulfillmentOrderCreationBacklogStatusEnum.enumValues,
    waybill: waybillStatusEnum.enumValues,
    pick: outboundBatchWorkItemStatusEnum.enumValues,
    track: shipmentStatusEnum.enumValues,
    // 열린 반품 예정 기록만(K8 PR 10) — 정산·취소는 판정 SQL 이 거른다. 세부 상태는 '<종류>:<상태>'(K8 PR11b N9)
    return_exchange: customerReturnKindEnum.enumValues.flatMap((kind) =>
      customerReturnStatusEnum.enumValues
        .filter((v) => v !== 'settled' && v !== 'cancelled')
        .map((v) => `${kind}:${v}`),
    ),
  };

  it.each([...ORDER_PROGRESS_STAGES])('%s 의 세부 상태는 판정 SQL 이 실제로 낼 수 있는 값이다', (stage) => {
    const unknown = ORDER_PROGRESS_STATES[stage].filter(
      (state) => !judgeText.includes(`'${state}'`) && !(passthrough[stage] ?? []).includes(state),
    );
    // 오타가 섞이면 그 칸을 겨눈 규칙은 영원히 후보가 없고, deleteDeparted 가 그 규칙의 행을 조용히 지운다
    expect(unknown).toEqual([]);
  });

  it('12번 규칙의 칸(fo/awaiting_matching)이 어휘에 있다', () => {
    expect(ORDER_PROGRESS_STATES.fo).toContain('awaiting_matching');
  });
});

describe('SHIPMENT_STATES', () => {
  it.each([...SHIPMENT_STAGES])(
    '%s 의 상자 세부 상태는 같은 단계의 주문 어휘 안에 있다 — 판정 SQL 이 낼 수 있는 값',
    (stage) => {
      const orderStates: readonly string[] = ORDER_PROGRESS_STATES[stage];
      expect(SHIPMENT_STATES[stage].filter((s) => !orderStates.includes(s))).toEqual([]);
    },
  );

  it('입점사 상자의 drop_ship_* 는 겨누는 상자 규칙이 아직 없다 — 상자 어휘에 없다', () => {
    const all = SHIPMENT_STAGES.flatMap((stage): readonly string[] => SHIPMENT_STATES[stage]);
    expect(all.filter((s) => s.startsWith('drop_ship_'))).toEqual([]);
  });

  it('25번 규칙의 칸(pick/CONSOLIDATION_PENDING)이 상자 어휘에 있다', () => {
    expect(SHIPMENT_STATES.pick).toContain('CONSOLIDATION_PENDING');
  });
});

describe('정산 기한(스펙 §7.4 — 3영업일, 주말만 뺀다)', () => {
  it('환불 지연 기준은 30분', () => {
    expect(SETTLE_DELAYED_AFTER_MS).toBe(30 * 60_000);
  });

  it('월요일 10:00 KST 확정 → 목요일 10:00 KST', () => {
    // 2026-10-12 는 월요일. 10:00 KST = 01:00Z
    expect(settlementDeadline(new Date('2026-10-12T01:00:00.000Z')).toISOString()).toBe('2026-10-15T01:00:00.000Z');
  });

  it('금요일 확정 → 다음 주 수요일(토·일은 세지 않는다)', () => {
    expect(settlementDeadline(new Date('2026-10-09T01:00:00.000Z')).toISOString()).toBe('2026-10-14T01:00:00.000Z');
  });

  it('토요일 확정 → 수요일(월·화·수)', () => {
    expect(settlementDeadline(new Date('2026-10-10T01:00:00.000Z')).toISOString()).toBe('2026-10-14T01:00:00.000Z');
  });

  it('요일은 한국 시간으로 센다 — 런타임 TZ·UTC 요일이 아니다', () => {
    // 2026-10-10T20:00Z = 일요일 05:00 KST. 하루 뒤 2026-10-11T20:00Z = 월요일 05:00 KST(영업일) → 1영업일 소진.
    // UTC 요일로 세면 2026-10-11T20:00Z 는 «일요일»이라 건너뛰고 2026-10-12T20:00Z 가 나온다.
    expect(addBusinessDaysKst(new Date('2026-10-10T20:00:00.000Z'), 1).toISOString()).toBe('2026-10-11T20:00:00.000Z');
  });
});
