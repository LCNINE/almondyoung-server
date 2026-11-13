import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestError } from '@app/shared';
import { WowpressClient } from '../wowpress/wowpress.client';
import { WowpressProdInfo } from '../wowpress/wowpress.types';
import { PrintCatalogReader, PrintCombo } from './print-catalog.reader';
import { PRINT_KIND_PRODUCTS } from './print-kind-products';

const card: WowpressProdInfo = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'prod-info-40073.json'), 'utf8'),
);

const mini: WowpressProdInfo = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'prod-info-40162.json'), 'utf8'),
);
const banner: WowpressProdInfo = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'prod-info-40115.json'), 'utf8'),
);
const pet: WowpressProdInfo = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'prod-info-40106.json'), 'utf8'),
);

const combo = (key: string, qty = 500): PrintCombo => ({ key, paperno: 22904, colorno: 256, qty, awk: [] });
const miniCombo = (accessories?: string[], qty = 2): PrintCombo => ({
  key: 'm',
  paperno: 21029,
  colorno: 302,
  qty,
  awk: [11804],
  ...(accessories ? { accessories } : {}),
});

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
    expect(spec.confirmed).toBe(true);
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

  it('toSpec: 이름이 WxH 가 아닌 표준 크기도 width/height 로 맞춘다', () => {
    const menuInfo = {
      ...card,
      sizeinfo: [{ sizelist: [{ sizeno: 5678, sizename: 'A4(국8절)', width: 210, height: 297 }] }],
    };

    for (const size of [
      { width: 210, height: 297 },
      { width: 297, height: 210 },
    ]) {
      expect(reader.toSpec('menu', size, combo('k'), menuInfo).prsjob[0]).toMatchObject({ sizeno: 5678 });
    }
  });

  it('options: 크기에 맞는 축과 bleedMatches 를 돌려준다', async () => {
    const view = await reader.options('bizcard', { width: 90, height: 50 });

    expect(view.prodno).toBe(40073);
    expect(view.bleedMatches).toBe(true);
  });

  it('options: 와우프레스 재단 여유가 편집기 메뉴판 재단 여유 3mm 와 다르면 bleedMatches 가 false', async () => {
    const menuInfo = (cutsize: number) => ({
      ...card,
      sizeinfo: [{ sizelist: [{ sizeno: 5678, sizename: 'A4(국8절)', width: 210, height: 297, cutsize }] }],
    });

    const viewWith = (cutsize: number) =>
      new PrintCatalogReader({
        prodInfo: jest.fn().mockResolvedValue(menuInfo(cutsize)),
        jobcost,
      } as unknown as WowpressClient).options('menu', { width: 210, height: 297 });

    expect((await viewWith(0)).bleedMatches).toBe(false);
    expect((await viewWith(6)).bleedMatches).toBe(true);
  });

  it('편집기 재단 여유는 종류마다 스토어프론트 PRINT_SPECS 의 bleedMm 과 같다', () => {
    const catalog = readFileSync(
      join(__dirname, '../../../../../../web/almondyoung-storefront/src/domains/almond-template/lib/catalog.ts'),
      'utf8',
    );
    const specs = catalog.slice(catalog.indexOf('export const PRINT_SPECS'));
    const editorBleed = new Map(
      [...specs.matchAll(/^ {2}(\w+): \{[\s\S]*?bleedMm: ([\d.]+),/gm)].map((m) => [m[1], Number(m[2])]),
    );

    for (const [kind, products] of Object.entries(PRINT_KIND_PRODUCTS)) {
      for (const product of products) expect([kind, product.bleedMm]).toEqual([kind, editorBleed.get(kind)]);
    }
  });

  it('quotes: 조합마다 순차로 jobcost(qty 1)를 한 번씩 부르고 실패는 다른 조합을 막지 않는다', async () => {
    let release: (v: unknown) => void = () => undefined;
    jobcost
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, supply: 3, bill: 4 });

    const pending = reader.quotes('bizcard', { width: 90, height: 50 }, [
      combo('a', 500),
      combo('b', 1000),
      combo('c', 2000),
    ]);
    await new Promise((r) => setImmediate(r));

    expect(jobcost).toHaveBeenCalledTimes(1);

    release({ ok: true, supply: 1, bill: 2 });
    const result = await pending;

    expect(jobcost.mock.calls.map(([spec, qty]) => [spec.qtyPerUnit, qty])).toEqual([
      [500, 1],
      [1000, 1],
      [2000, 1],
    ]);
    expect(result).toEqual([
      { key: 'a', verdict: { ok: true, supply: 1, bill: 2 } },
      { key: 'b', verdict: { ok: false, reason: 'boom' } },
      { key: 'c', verdict: { ok: true, supply: 3, bill: 4 } },
    ]);
  });

  describe('부자재', () => {
    it('toSpec: 고른 거치대를 배너와 같은 규격의 부자재로 싣고, 개수는 배너 수량과 따로 간다', () => {
      const spec = reader.toSpec('mini', { width: 150, height: 300 }, miniCombo(['stand-3'], 2), mini);

      expect(spec.qtyPerUnit).toBe(2);
      expect(spec.accessories).toEqual([
        { prodno: 40119, jobpresetno: '30', prsjob: [{ covercd: 0, jobno: 30, sizeno: 5668 }], qtyPerUnit: 3 },
      ]);
      expect(reader.toSpec('mini', { width: 150, height: 300 }, miniCombo(), mini)).not.toHaveProperty('accessories');
    });

    it('toSpec: PET 거치대는 배너 수량만큼, 큐방은 고른 개수만큼 싣는다', () => {
      const petInfo = pet.paperinfo as { paperlist: { paperno: number }[] }[];
      const colorInfo = pet.colorinfo as { pagelist: { colorlist: { colorno: number }[] }[] }[];
      const spec = reader.toSpec(
        'pet',
        { width: 600, height: 1800 },
        {
          key: 'p',
          paperno: petInfo[0].paperlist[0].paperno,
          colorno: colorInfo[0].pagelist[0].colorlist[0].colorno,
          qty: 2,
          awk: [],
          accessories: ['indoor', 'qbang-8'],
        },
        pet,
      );

      expect(spec.accessories?.map((a) => [a.prodno, a.qtyPerUnit])).toEqual([
        [40586, 2],
        [40080, 8],
      ]);
      expect(spec.accessories?.[1].prsjob).toEqual([{ covercd: 0, jobno: 30 }]);
    });

    it('toSpec: 현수막 큐방은 같은 개수의 아일렛을 주제품 후가공에 함께 넣는다', () => {
      const paperInfo = banner.paperinfo as { paperlist: { paperno: number }[] }[];
      const colorInfo = banner.colorinfo as { pagelist: { colorlist: { colorno: number }[] }[] }[];
      const spec = reader.toSpec(
        'window',
        { width: 600, height: 600 },
        {
          key: 'w',
          paperno: paperInfo[0].paperlist[0].paperno,
          colorno: colorInfo[0].pagelist[0].colorlist[0].colorno,
          qty: 1,
          awk: [11411],
          accessories: ['qbang-8'],
        },
        banner,
      );

      expect(spec.awkjob).toEqual([
        { covercd: 0, jobno: 11411 },
        { covercd: 0, jobno: 42103 },
      ]);
      expect(spec.accessories?.map((a) => [a.prodno, a.qtyPerUnit])).toEqual([[40080, 8]]);
    });

    it('options: 그 종류의 부자재 축을 함께 돌려준다', async () => {
      prodInfo.mockResolvedValue(mini);
      const view = await reader.options('mini', { width: 150, height: 300 });

      expect(view.accessoryAxes.map((axis) => axis.group)).toEqual(['거치대']);
      prodInfo.mockResolvedValue(card);
      expect((await reader.options('nail', { width: 90, height: 90 })).accessoryAxes).toEqual([]);
    });

    it('quotes: 배너와 부자재 견적을 더하고, 모르는 키나 한 축에 둘을 고르면 실패로 돌려준다', async () => {
      prodInfo.mockResolvedValue(mini);
      jobcost
        .mockResolvedValueOnce({ ok: true, supply: 4400, bill: 4840, weightKg: 0.01125 })
        .mockResolvedValueOnce({ ok: true, supply: 4200, bill: 4620 });

      const [summed, unknown, doubled] = await reader.quotes('mini', { width: 150, height: 300 }, [
        miniCombo(['stand-3'], 1),
        { ...miniCombo(['stand-99'], 1), key: 'u' },
        { ...miniCombo(['stand-1', 'stand-2'], 1), key: 'd' },
      ]);

      expect(summed.verdict).toEqual({ ok: true, supply: 8600, bill: 9460, weightKg: 0.01125 });
      expect(jobcost.mock.calls[1][0]).toMatchObject({ prodno: 40119, qtyPerUnit: 3, awkjob: [] });
      expect(unknown.verdict.ok).toBe(false);
      expect(doubled.verdict.ok).toBe(false);
      expect(jobcost).toHaveBeenCalledTimes(2);
    });
  });
});
