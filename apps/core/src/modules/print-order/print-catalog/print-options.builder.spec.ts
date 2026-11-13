import { readFileSync } from 'fs';
import { join } from 'path';
import { WowpressProdInfo } from '../wowpress/wowpress.types';
import { buildPrintOptions } from './print-options.builder';

const load = (name: string): WowpressProdInfo =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));

describe('buildPrintOptions', () => {
  const card = load('prod-info-40073.json');
  const pet = load('prod-info-40106.json');
  const banner = load('prod-info-40115.json');
  const mini = load('prod-info-40162.json');

  it('일반명함: 용지, 색상, 수량, 재단 여유를 뽑는다', () => {
    const axes = buildPrintOptions(card, { sizeno: 5458 });

    expect(axes.prodno).toBe(40073);
    expect(axes.papers.map((p) => p.paperno)).toEqual(expect.arrayContaining([22904, 22907, 22908]));
    expect(axes.colors).toEqual(
      expect.arrayContaining([
        { colorno: 255, label: '단면 칼라4도', jobno: 3110 },
        { colorno: 256, label: '양면 칼라8도', jobno: 3110 },
      ]),
    );
    expect(axes.quantities[0].values).toEqual(expect.arrayContaining([500, 1000, 2000]));
    expect(axes.cutsizeHalfMm).toBe(1);
    expect(axes.requiredAwk).toEqual([]);
  });

  it('50x90 은 박 11538 이 금지되고 90x50 은 아니다', () => {
    const small = buildPrintOptions(card, { sizeno: 10732 });
    const normal = buildPrintOptions(card, { sizeno: 5458 });

    expect(small.forbiddenAwk.map((f) => f.jobno)).toContain(11538);
    expect(normal.forbiddenAwk.map((f) => f.jobno)).not.toContain(11538);
  });

  it('비규격은 wsize/hsize 로 범위를 판정한다', () => {
    const wide = buildPrintOptions(card, { sizeno: 7071, wsize: 100, hsize: 100 });
    const narrow = buildPrintOptions(card, { sizeno: 7071, wsize: 50, hsize: 90 });

    const wideJobs = wide.forbiddenAwk.map((f) => f.jobno);
    const narrowJobs = narrow.forbiddenAwk.map((f) => f.jobno);

    expect(narrowJobs).toContain(11347);
    expect(wideJobs).not.toContain(11347);
  });

  it('PET배너: radio 그룹은 필수이고 기본값은 첫 옵션이다', () => {
    const axes = buildPrintOptions(pet, { sizeno: 5670 });

    expect(axes.requiredAwk.map((g) => g.group)).toEqual(['쿨코팅', '아일렛']);
    for (const group of axes.requiredAwk) {
      expect(group.defaultJobno).toBe(group.options[0].jobno);
    }
    expect(axes.requiredAwk[0].defaultJobno).toBe(12302);
    expect(axes.requiredAwk[1].defaultJobno).toBe(42101);
    expect(axes.cutsizeHalfMm).toBe(0);
    expect(axes.colors[0].jobno).toBe(30);
  });

  it('일반현수막: 후가공 하나 이상 필수인 묶음은 기본 후가공이 든 그룹을 필수로 둔다', () => {
    const axes = buildPrintOptions(banner, { sizeno: 5666, wsize: 600, hsize: 600, awkDefaults: [11411] });

    expect(axes.requiredAwk).toHaveLength(1);
    expect(axes.requiredAwk[0].group).toBe('테두리마감');
    expect(axes.requiredAwk[0].defaultJobno).toBe(11411);
  });

  it('일반현수막: 기본 후가공이 없으면 고를 수 없으니 던진다', () => {
    expect(() => buildPrintOptions(banner, { sizeno: 5666, wsize: 600, hsize: 600 })).toThrow('awkDefaults');
  });

  it('미니 투명배너: 사방타공은 기본 후가공으로 고르고 뺀 도수는 내지 않는다', () => {
    const axes = buildPrintOptions(mini, { sizeno: 5668, awkDefaults: [11804], excludeColors: [1355] });

    expect(axes.requiredAwk.map((g) => [g.group, g.defaultJobno])).toEqual([['사방타공', 11804]]);
    expect(axes.colors.map((c) => c.colorno)).toEqual([302]);
  });

  it('수량 조건이 맞지 않는 목록은 거른다', () => {
    const conditioned: WowpressProdInfo = {
      ...card,
      ordqty: [
        { sizeno: 5458, paperno: null, colorno: null, ordqtylist: [100] },
        { sizeno: 9999, paperno: null, colorno: null, ordqtylist: [200] },
        { sizeno: null, paperno: 22904, colorno: null, ordqtylist: [300] },
      ],
    };

    const axes = buildPrintOptions(conditioned, { sizeno: 5458 });

    expect(axes.quantities.flatMap((q) => q.values).sort()).toEqual([100, 300]);
  });

  it('인쇄 작업 번호를 못 찾으면 던진다', () => {
    const unresolvable: WowpressProdInfo = { ...pet, prsjobinfo: [] };

    expect(() => buildPrintOptions(unresolvable, { sizeno: 5670 })).toThrow('prs jobno');
  });

  it('작업 번호 0 은 없는 것으로 보고 다음 출처로 넘어간다', () => {
    const colorinfo = [{ pagelist: [{ colorlist: [{ colorno: 302, colorname: '단면 칼라', req_prsjob: [{ jobno: 0 }] }] }] }];
    const withFallback: WowpressProdInfo = { ...pet, colorinfo };
    const allZero: WowpressProdInfo = { ...pet, colorinfo, prsjobinfo: [{ prsjoblist: [{ jobno: 0, req_color: null }] }] };

    expect(buildPrintOptions(withFallback, { sizeno: 5670 }).colors[0].jobno).toBe(30);
    expect(() => buildPrintOptions(allZero, { sizeno: 5670 })).toThrow('prs jobno');
  });
});
