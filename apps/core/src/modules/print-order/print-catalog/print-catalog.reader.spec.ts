import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestError } from '@app/shared';
import { WowpressClient } from '../wowpress/wowpress.client';
import { WowpressProdInfo } from '../wowpress/wowpress.types';
import { PrintCatalogReader, PrintCombo } from './print-catalog.reader';

const card: WowpressProdInfo = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'prod-info-40073.json'), 'utf8'),
);

const combo = (key: string, qty = 500): PrintCombo => ({ key, paperno: 22904, colorno: 256, qty, awk: [] });

describe('PrintCatalogReader', () => {
  const prodInfo = jest.fn();
  const jobcost = jest.fn();
  const reader = new PrintCatalogReader({ prodInfo, jobcost } as unknown as WowpressClient);

  beforeEach(() => {
    prodInfo.mockReset().mockResolvedValue(card);
    jobcost.mockReset();
  });

  it('toSpec: 일반명함 90x50 을 와우프레스 작업 사양으로 바꾼다', () => {
    const spec = reader.toSpec('bizcard', { width: 90, height: 50 }, combo('k'), card);

    expect(spec.prodno).toBe(40073);
    expect(spec.prsjob).toEqual([{ covercd: 0, sizeno: 5458, paperno: 22904, colorno: 256, jobno: 3110 }]);
    expect(spec.qtyPerUnit).toBe(500);
    expect(spec.file).toEqual({ format: 'pdf', dpi: 300 });
    expect(spec.confirmed).toBe(false);
    expect(spec.jobpresetno).toBe('3110');
  });

  it('toSpec: 가로세로를 뒤집어도 같은 크기로 고르고 후가공을 awkjob 으로 옮긴다', () => {
    const spec = reader.toSpec('bizcard', { width: 50, height: 90 }, { ...combo('k'), awk: [11538] }, card);

    expect(spec.prsjob[0]).toMatchObject({ sizeno: 5458 });
    expect(spec.awkjob).toEqual([{ covercd: 0, jobno: 11538 }]);
  });

  it('toSpec: 비규격은 wsize/hsize 를 prsjob 에 싣는다', () => {
    const spec = reader.toSpec('nail', { width: 90, height: 90 }, combo('k'), card);

    expect(spec.prsjob[0]).toMatchObject({ sizeno: 7071, wsize: 90, hsize: 90 });
  });

  it('toSpec: 맞는 크기가 없으면 BadRequestError', () => {
    expect(() => reader.toSpec('bizcard', { width: 10, height: 10 }, combo('k'), card)).toThrow(BadRequestError);
  });

  it('options: 크기에 맞는 축과 bleedMatches 를 돌려준다', async () => {
    const view = await reader.options('bizcard', { width: 90, height: 50 });

    expect(view.prodno).toBe(40073);
    expect(view.bleedMatches).toBe(true);
  });

  it('quotes: 조합마다 순차로 jobcost 를 한 번씩 부르고 실패는 다른 조합을 막지 않는다', async () => {
    const order: string[] = [];
    jobcost.mockImplementation(async (spec: { qtyPerUnit: number }) => {
      order.push(String(spec.qtyPerUnit));
      if (spec.qtyPerUnit === 1000) throw new Error('boom');

      return { ok: true, supply: 1, bill: 2 };
    });

    const result = await reader.quotes('bizcard', { width: 90, height: 50 }, [
      combo('a', 500),
      combo('b', 1000),
      combo('c', 2000),
    ]);

    expect(order).toEqual(['500', '1000', '2000']);
    expect(result.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(result[0].verdict).toEqual({ ok: true, supply: 1, bill: 2 });
    expect(result[1].verdict).toEqual({ ok: false, reason: 'boom' });
    expect(result[2].verdict.ok).toBe(true);
  });
});
