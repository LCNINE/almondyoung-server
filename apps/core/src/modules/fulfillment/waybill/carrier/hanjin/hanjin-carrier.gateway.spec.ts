import { HanjinCarrierGateway } from './hanjin-carrier.gateway';
import type { WaybillRequest } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';
import { assembleWaybillRequest } from '../../waybill-request.assembler';

const config = {
  clientId: 'HANJIN',
  apiKey: 'k',
  secretKey: 's',
  contractNo: '9117159',
  orderBaseUrl: 'https://api-stg.hanjin.com',
  printBaseUrl: 'https://ebbapd.hjt.co.kr',
  timeoutMs: 15000,
  sender: { name: '창고', zip: '08588', baseAddress: '금천구', detailAddress: '지점', tel: '02-1' },
  boxType: 'A',
  payType: 'PP',
} as HanjinConfig;

const req: WaybillRequest = {
  custOrdNo: 'SO-1',
  recipient: {
    name: '김택배',
    zip: '04532',
    baseAddress: '서울시 중구 소공로 88',
    detailAddress: '999층',
    tel: '02-2',
    mobile: '010-2',
  },
  sender: config.sender,
  items: [{ name: '의류', code: 'A1', quantity: 1 }],
  commodityName: '의류',
  boxType: 'A',
  payType: 'PP',
};

function gateway(clientStub: any) {
  return new HanjinCarrierGateway(config, clientStub);
}

describe('HanjinCarrierGateway.allocate', () => {
  it('print-wbl OK → waybillNo + labelData(분류필드)', async () => {
    const post = jest.fn().mockResolvedValue({
      result_code: 'OK',
      wbl_num: '531647410114',
      s_tml_cod: '442',
      tml_cod: '150',
      cen_cod: '1050',
      grp_rnk: 'Z99',
      es_nam: '김한진',
      prt_add: '소공동 51',
      dom_rgn: '1',
    });
    const res = await gateway({ post }).allocate(req);
    expect(res.waybillNo).toBe('531647410114');
    expect(res.labelData).toMatchObject({ tml_cod: '150', cen_cod: '1050', es_nam: '김한진' });
    // print 호스트 + custOrdNo=msg_key 로 호출
    expect(post).toHaveBeenCalledWith(
      'print',
      '/v1/wbl/HANJIN/print-wbl',
      expect.objectContaining({
        client_id: 'HANJIN',
        csr_num: '9117159',
        snd_zip: '08588',
        rcv_zip: '04532',
        msg_key: 'SO-1',
      }),
    );
  });

  it('print-wbl ERROR-xx → CarrierError definitive_rejection (구체 코드 보존)', async () => {
    const post = jest.fn().mockResolvedValue({ result_code: 'ERROR-04', result_message: '유효하지 않은 주소' });
    await expect(gateway({ post }).allocate(req)).rejects.toMatchObject({
      outcome: 'definitive_rejection',
      details: { code: 'ERROR-04' },
    });
  });

  // 정본 §4.1 의 「성질」열이 일시적인 두 코드만 transient 다. 나머지 ERROR-xx 를 여기 넣으면
  // 영원히 풀리지 않을 사유를 붙들고 재시도하게 된다.
  it.each([
    ['ERROR-05', { kind: 'next_day' }],
    ['ERROR-06', { kind: 'after_ms', ms: 60 * 60 * 1000 }],
  ])('print-wbl %s → transient_rejection (retryAfter 힌트 포함)', async (code, retryAfter) => {
    const post = jest.fn().mockResolvedValue({ result_code: code, result_message: '일시적' });
    await expect(gateway({ post }).allocate(req)).rejects.toMatchObject({
      outcome: 'transient_rejection',
      details: { code, retryAfter },
    });
  });

  it('일시적 표에 없는 ERROR 코드는 영구 거절이다', async () => {
    for (const code of ['ERROR-01', 'ERROR-02', 'ERROR-03', 'ERROR-99']) {
      const post = jest.fn().mockResolvedValue({ result_code: code });
      await expect(gateway({ post }).allocate(req)).rejects.toMatchObject({
        outcome: 'definitive_rejection',
        details: { code },
      });
    }
  });

  it('print-wbl OK 인데 wbl_num 누락 → definitive_rejection code=no_wbl_num', async () => {
    const post = jest.fn().mockResolvedValue({ result_code: 'OK' });
    await expect(gateway({ post }).allocate(req)).rejects.toMatchObject({
      outcome: 'definitive_rejection',
      details: { code: 'no_wbl_num' },
    });
  });

  it('capabilities / carrier / isConfigured', () => {
    const g = gateway({ post: jest.fn() });
    expect(g.carrier).toBe('HANJIN');
    expect(g.capabilities).toEqual({
      allocatesExternally: true,
      registersSeparately: true,
      canTrack: true,
      canCancel: false,
    });
    expect(g.isConfigured()).toBe(true);
  });
});

describe('HanjinCarrierGateway.register', () => {
  const today = () => new Date('2023-10-09T06:28:39Z');
  it('insert-order OK → registered, order 호스트·svcCatCd=S·wblNo 전달', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'OK', resultMessage: 'SUCCESS' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    const out = await g.register('531647410114', req);
    expect(out).toEqual({ kind: 'registered' });
    expect(post).toHaveBeenCalledWith('order', '/parcel-delivery/v1/order/insert-order', {
      custEdiCd: 'HANJIN',
      custOrdNo: 'SO-1',
      wblNo: '531647410114',
      svcCatCd: 'S',
      cntractNo: '9117159',
      pickupAskDt: '20231009',
      sndrZip: '08588',
      sndrBaseAddr: '금천구',
      sndrDtlAddr: '지점',
      sndrNm: '창고',
      sndrTelNo: '02-1',
      rcvrZip: '04532',
      rcvrBaseAddr: '서울시 중구 소공로 88',
      rcvrDtlAddr: '999층',
      rcvrNm: '김택배',
      rcvrTelNo: '02-2',
      rcvrMobileNo: '010-2',
      rcvrAskCntent: '',
      comodityNm: '의류',
      payTypCd: 'PP',
      boxTypCd: 'A',
      comodityList: [{ comodityCd: 'A1', comodityNm: '의류', comodityCnt: '1' }],
    });
  });

  // #911 회귀: §4.2 에서 19번 rcvrTelNo 가 필수, 20번 rcvrMobileNo 가 선택이다.
  // 휴대폰만 받는 커머스 주문에서 tel 이 비면 ERROR-01 로 전건 거절된다.
  it('수하인 tel 이 없으면 rcvrTelNo 를 mobile 로 채운다 (둘 다 싣는다)', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'OK', resultMessage: 'SUCCESS' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    const mobileOnly: WaybillRequest = { ...req, recipient: { ...req.recipient, tel: undefined } };
    await g.register('531647410114', mobileOnly);
    expect(post).toHaveBeenCalledWith(
      'order',
      '/parcel-delivery/v1/order/insert-order',
      expect.objectContaining({ rcvrTelNo: '010-2', rcvrMobileNo: '010-2' }),
    );
  });

  it('수하인 tel 이 있으면 그대로 쓰고 mobile 을 덮지 않는다', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'OK', resultMessage: 'SUCCESS' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    await g.register('531647410114', req);
    expect(post).toHaveBeenCalledWith(
      'order',
      '/parcel-delivery/v1/order/insert-order',
      expect.objectContaining({ rcvrTelNo: '02-2', rcvrMobileNo: '010-2' }),
    );
  });

  it('insert-order ERROR-09(기등록) → already_registered (멱등 성공)', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'ERROR-09', resultMessage: '기등록 운송장번호' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    expect(await g.register('531647410114', req)).toEqual({ kind: 'already_registered' });
  });

  it('insert-order ERROR-06 → rejected(reason)', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'ERROR-06', resultMessage: '유효하지 않은 수하인 주소' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    expect(await g.register('531647410114', req)).toEqual({
      kind: 'rejected',
      reason: 'ERROR-06: 유효하지 않은 수하인 주소',
    });
  });
});

describe('HanjinCarrierGateway.track', () => {
  it('wrkList → CarrierScan[] (statusCode 매핑)', async () => {
    const post = jest.fn().mockResolvedValue({
      resultCode: 'OK',
      wblNo: '777',
      wrkList: [
        {
          statusCode: '11',
          statusName: '집하완료',
          statusDate: '2023-07-29 19:10:00',
          agencyName: '구로(집)',
          description: 'x',
        },
        {
          statusCode: '66',
          statusName: '배송완료',
          statusDate: '2023-07-30 15:20:00',
          reasonCode: '01',
          reasonMessage: '본인',
        },
      ],
    });
    const scans = await new HanjinCarrierGateway(config, { post } as any).track('777');
    expect(scans).toHaveLength(2);
    expect(scans[0]).toMatchObject({ statusCode: '11', status: 'in_transit' });
    expect(scans[1]).toMatchObject({ statusCode: '66', status: 'delivered', reasonMessage: '본인' });
    expect(post).toHaveBeenCalledWith('order', '/parcel-delivery/v1/tracking/tracking-wbl', {
      custEdiCd: 'HANJIN',
      wblNo: '777',
    });
  });

  it('ERROR-01(스캔 없음) → 빈 배열', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'ERROR-01', resultMessage: '존재하지 않는 운송장번호' });
    expect(await new HanjinCarrierGateway(config, { post } as any).track('777')).toEqual([]);
  });
});

// #911 회귀 — 결함이 assembler(단일 phone → mobile)와 gateway(tel 그대로 전송) 사이에서 났으므로
// 스냅샷부터 insert-order 바디까지 한 번에 본다.
describe('주문 스냅샷 → insert-order 바디 (#911)', () => {
  it('스냅샷에 휴대폰만 있어도 rcvrTelNo 가 비지 않는다', async () => {
    const assembled = assembleWaybillRequest({
      shipmentId: '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      recipientSnapshot: {
        recipientName: '김택배',
        phone: '010-1234-5678',
        postalCode: '04532',
        roadAddress: '서울시 중구 소공로 88',
        detailAddress: '999층',
      },
      lines: [{ productName: '의류', quantity: 1, skuId: 'sku-1' }],
      config,
    });
    const post = jest.fn().mockResolvedValue({ resultCode: 'OK', resultMessage: 'SUCCESS' });
    await new HanjinCarrierGateway(config, { post } as any).register('531647410114', assembled);
    expect(post).toHaveBeenCalledWith(
      'order',
      '/parcel-delivery/v1/order/insert-order',
      expect.objectContaining({ rcvrTelNo: '010-1234-5678' }),
    );
  });
});
