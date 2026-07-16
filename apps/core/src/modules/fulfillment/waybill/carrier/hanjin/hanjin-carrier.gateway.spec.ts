import { HanjinCarrierGateway } from './hanjin-carrier.gateway';
import type { WaybillRequest } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';

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
