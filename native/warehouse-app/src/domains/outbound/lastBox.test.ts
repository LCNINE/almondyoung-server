import { describe, it, expect } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { clearLastBox, readLastBox, writeLastBox } from './lastBox';
import type { ShipmentByWaybill } from './types';

const shipment: ShipmentByWaybill = {
  shipmentId: 's-1',
  trackingNo: 'T-1',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'queued',
  recipientMasked: '홍길**',
  lines: [],
};

describe('lastBox', () => {
  it('쓰고 읽는다', () => {
    const prefs = createMemoryPrefs();
    writeLastBox(prefs, shipment);
    expect(readLastBox(prefs)).toEqual(shipment);
  });

  it('지우면 null 이다', () => {
    const prefs = createMemoryPrefs();
    writeLastBox(prefs, shipment);
    clearLastBox(prefs);
    expect(readLastBox(prefs)).toBeNull();
  });

  it('깨진 값은 null 로 흘린다 — 복구 카드가 앱을 못 띄우게 하면 안 된다', () => {
    const prefs = createMemoryPrefs({ 'almondwms.outbound.lastBox': '{not json' });
    expect(readLastBox(prefs)).toBeNull();
  });
});
