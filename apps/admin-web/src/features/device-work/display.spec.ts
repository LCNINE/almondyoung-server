import type {
  DeviceWorkItem,
  DeviceWorkVerdict,
} from '@/lib/api/domains/device-work';
import {
  VERDICT_VIEW,
  confirmText,
  groupByDevice,
  lastReportText,
  waitingText,
  workText,
} from './display';

const item = (over: Partial<DeviceWorkItem>): DeviceWorkItem => ({
  operationKey: 'k',
  deviceId: '00000000-0000-4000-8000-00000000abcd',
  deviceKind: 'station',
  workerName: '김현장',
  workName: '입고',
  summary: '데모 상품 11 ×3',
  path: '/inbound/simple',
  deviceStatus: 'uncertain',
  attempts: 4,
  errorCode: null,
  recordedAt: '2026-11-26T01:00:00.000Z',
  lastReportedAt: '2026-11-26T02:00:00.000Z',
  verdict: 'not_applied',
  ...over,
});

describe('기기 확인할 일 표시', () => {
  it('서버에 없는 작업만 버릴 수 있고, 처리 중인 작업은 아무것도 누를 수 없다', () => {
    const actions = Object.fromEntries(
      (Object.keys(VERDICT_VIEW) as DeviceWorkVerdict[]).map((v) => [
        v,
        VERDICT_VIEW[v].action?.kind ?? null,
      ])
    );
    expect(actions).toEqual({
      not_applied: 'abandon',
      applied: 'dismiss',
      rejected: 'dismiss',
      abandoned: 'dismiss',
      in_progress: null,
      expired: 'dismiss',
    });
  });

  it('기기마다 묶어 가장 오래 남은 기기부터, 기기 안에서는 오래된 작업부터 보인다', () => {
    const groups = groupByDevice([
      item({
        operationKey: 'b2',
        deviceId: 'b',
        recordedAt: '2026-11-26T03:00:00.000Z',
      }),
      item({
        operationKey: 'a1',
        deviceId: 'a',
        recordedAt: '2026-11-26T02:00:00.000Z',
        deviceKind: 'handheld',
        workerName: null,
      }),
      item({
        operationKey: 'b1',
        deviceId: 'b',
        recordedAt: '2026-11-26T01:00:00.000Z',
        workerName: '이포장',
      }),
    ]);
    expect(groups.map((g) => g.deviceId)).toEqual(['b', 'a']);
    expect(groups[0].items.map((i) => i.operationKey)).toEqual(['b1', 'b2']);
    expect(groups[0].title).toBe('스테이션 · 기기 B · 김현장, 이포장');
    expect(groups[1].title).toBe('핸드헬드 · 기기 A');
  });

  it('기기가 오래 보고하지 않으면 꺼졌을 수 있다고 알린다', () => {
    const now = new Date('2026-11-26T02:10:00.000Z');
    expect(lastReportText('2026-11-26T02:05:00.000Z', now)).toBe(
      '마지막 보고 5분 전'
    );
    expect(lastReportText('2026-11-26T01:30:00.000Z', now)).toBe(
      '마지막 보고 40분 전 — 기기가 꺼졌거나 연결되지 않았어요'
    );
  });

  it('기기에 남은 시간은 «N분째»로, 1분이 안 되면 «방금»으로 말한다', () => {
    const now = new Date('2026-11-26T01:05:00.000Z');
    expect(
      waitingText(item({ recordedAt: '2026-11-26T01:04:30.000Z' }), now)
    ).toBe('방금 기기에 남았어요');
    expect(waitingText(item({}), now)).toBe('기기에 남은 지 5분째');
  });

  it('버리기 확인 창은 버리면 무엇이 되는지와 현장에서 할 일을 말한다', () => {
    expect(workText(item({}))).toBe('입고 · 데모 상품 11 ×3');
    expect(workText(item({ summary: null }))).toBe('입고');
    expect(confirmText(item({}), 'abandon')).toEqual({
      title: '‘입고 · 데모 상품 11 ×3’ 작업을 버릴까요?',
      body: '버리면 서버가 이 작업을 다시 받지 않아요. 물건을 실제로 옮겼거나 입고했다면 현장에서 새로 해야 재고가 맞아요.',
    });
    expect(confirmText(item({ verdict: 'applied' }), 'dismiss').body).toBe(
      VERDICT_VIEW.applied.next
    );
  });
});
