import { ConflictError } from '@app/shared';
import { DbTx } from '../../inventory/schema/inventory.schema';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { SvgRasterizer } from './label/svg-rasterizer';
import { assertContextMatchesWaybill, assertLabelAvailable, WaybillLabelManager } from './waybill-label.manager';
import type { IssueContext } from './waybill.types';

const base = { id: 'w1', source: 'carrier' as const, carrier: 'HANJIN' as const, labelData: { hub_cod: 'NX' } };

describe('assertLabelAvailable', () => {
  it('한진이 발급한 운송장은 통과', () => {
    expect(() => assertLabelAvailable(base)).not.toThrow();
  });

  it('수기 등록 운송장은 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => assertLabelAvailable({ ...base, source: 'manual', labelData: null });
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('한진이 아닌 캐리어는 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => assertLabelAvailable({ ...base, carrier: 'CJ' });
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('캐리어 발급인데 labelData 가 없으면 500(불변식 위반) — 도메인 에러가 아니다', () => {
    const run = () => assertLabelAvailable({ ...base, labelData: null });
    expect(run).toThrow(/labelData/);
    expect(run).not.toThrow(ConflictError);
  });
});

// assertDispatchable 과 loadIssueContext 사이(READ COMMITTED 별개 statement)에 수하인 정정이 커밋되면,
// 해시 검사(assertDispatchable)는 통과했는데 실제 조립은 새 주소를 쓰는 레이스가 생긴다(#913 최종리뷰).
// render() 는 loadIssueContext 직후 이 순수 함수로 재확인한다.
describe('assertContextMatchesWaybill', () => {
  const waybill = { id: 'w1', manifestVersion: 3, recipientHash: 'hash-a' };
  const ctx = { manifestVersion: 3, recipientSnapshot: { any: 'thing' } };
  const hashOf = () => 'hash-a';

  it('매니페스트 버전·수하인 해시가 모두 일치하면 통과', () => {
    expect(() => assertContextMatchesWaybill(waybill, ctx, hashOf)).not.toThrow();
  });

  it('가드 이후 매니페스트 버전이 바뀌면 409 WAYBILL_STALE', () => {
    const run = () => assertContextMatchesWaybill(waybill, { ...ctx, manifestVersion: 4 }, hashOf);
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_STALE/);
  });

  it('가드 이후 수하인이 바뀌면(해시 불일치) 409 WAYBILL_STALE', () => {
    const run = () => assertContextMatchesWaybill(waybill, ctx, () => 'hash-b');
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/WAYBILL_STALE/);
  });
});

// render() 는 this.config.labelType 으로 템플릿을 고르고 spec.rotation 을 encodeZpl 에 그대로 넘긴다.
// DB 없이(단위) 그 배선이 살아 있는지 확인한다 — 이 테스트가 없으면 한쪽만 바뀌어도(회전은 그대로 두고
// 템플릿만 NL 로 바꾸는 등) CI 가 못 잡는다: NL 을 rotation 90 으로 잘못 돌리면 프린터에 넣는 방향 폭이
// 816dot 로 108mm(864dot) 안에 들어가 인쇄폭 가드도 못 잡는다(#913 최종리뷰 F1).
describe('WaybillLabelManager.render — labelType 배선', () => {
  const HASH = 'recipient-hash-a';

  const WAYBILL_ROW = {
    id: 'w1',
    source: 'carrier' as const,
    carrier: 'HANJIN' as const,
    trackingNo: '452716978431',
    custOrdNo: 'AY0123456789ABCDEFGHJKMNPQRS',
    labelData: {
      hub_cod: 'NX',
      tml_cod: '150',
      tml_nam: '중구',
      dom_mid: 'Z',
      cen_cod: '1050',
      cen_nam: '해운(집)',
      s_tml_cod: '000',
      s_tml_nam: '본사',
      grp_rnk: 'A1',
      es_nam: '권순천',
      es_cod: '888',
      prt_add: '소공동 51 한진빌딩',
      dom_rgn: '1',
    },
    manifestVersion: 1,
    recipientHash: HASH,
  };

  // hanjin-label-data.spec.ts 의 CTX 와 같은 모양을 재사용한다.
  const CTX: IssueContext = {
    shipmentId: 's1',
    status: 'planned',
    manifestVersion: 1,
    recipientSnapshot: {
      recipientName: '김한진',
      phone: '010-1234-5678',
      postalCode: '04533',
      roadAddress: '서울특별시 중구 남대문로 63',
      detailAddress: '한진빌딩 10층',
      deliveryNote: '문앞',
    },
    lines: [{ productName: '토익 Speaking', skuName: '토익 Speaking', quantity: 1, skuId: 'k1' }],
    entrancePassword: '#1234',
  };

  const CONFIG_BASE: Omit<HanjinConfig, 'labelType'> = {
    clientId: 'C',
    apiKey: 'A',
    secretKey: 'S',
    contractNo: 'N',
    orderBaseUrl: 'https://o',
    printBaseUrl: 'https://p',
    timeoutMs: 1000,
    sender: {
      name: '아몬드영',
      zip: '14521',
      baseAddress: '경기도 부천시 오정구 신흥로511번길 80',
      detailAddress: '1층',
      tel: '032-000-1234',
    },
    boxType: 'A',
    payType: 'CD',
  };

  function buildManager(labelType: string): WaybillLabelManager {
    const waybills = { assertDispatchable: jest.fn().mockResolvedValue(WAYBILL_ROW) } as never;
    const reader = {
      loadIssueContext: jest.fn().mockResolvedValue(CTX),
      recipientHashOf: jest.fn().mockReturnValue(HASH),
    } as never;
    const FAKE_TX = {} as unknown as DbTx;
    const dbService = {
      run: (fn: (trx: DbTx) => Promise<unknown>, tx?: DbTx) => fn(tx ?? FAKE_TX),
    } as never;
    const config: HanjinConfig = { ...CONFIG_BASE, labelType };
    return new WaybillLabelManager(
      waybills,
      reader,
      new SvgRasterizer(),
      config,
      dbService,
      () => new Date('2026-09-27T01:00:00Z'),
    );
  }

  it('NS: rotation 90 으로 인코딩된다(^PW816·^LL1600·^B2R)', async () => {
    const label = await buildManager('NS').render('s1');
    expect(label.data).toContain('^PW816');
    expect(label.data).toContain('^LL1600');
    expect(label.data).toContain('^B2R');
  });

  it('NL: rotation 0 으로 인코딩된다(^PW800·^LL816·^B2N)', async () => {
    const label = await buildManager('NL').render('s1');
    expect(label.data).toContain('^PW800');
    expect(label.data).toContain('^LL816');
    expect(label.data).toContain('^B2N');
  });

  it('FS: rotation 90 으로 인코딩된다(^PW800·^LL984·^B2R)', async () => {
    const label = await buildManager('FS').render('s1');
    expect(label.data).toContain('^PW800');
    expect(label.data).toContain('^LL984');
    expect(label.data).toContain('^B2R');
  });

  it('품목이 한 쪽에 들어가면 pages 1, ^XA 하나', async () => {
    const label = await buildManager('NS').render('s1');
    expect(label.pages).toBe(1);
    expect(label.data.match(/\^XA/g)).toHaveLength(1);
  });

  it('모르는 HANJIN_LABEL_TYPE 은 라벨 요청만 거절한다', async () => {
    await expect(buildManager('XX').render('s1')).rejects.toThrow(/unknown HANJIN_LABEL_TYPE "XX"/);
  });
});
