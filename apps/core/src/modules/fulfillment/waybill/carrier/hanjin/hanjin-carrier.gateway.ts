import {
  AllocateResult,
  CarrierCapabilities,
  CarrierCode,
  CarrierError,
  CarrierGateway,
  CarrierScan,
  CarrierScanStatus,
  RegisterOutcome,
  RetryAfter,
  WaybillRequest,
} from '../carrier-gateway.interface';
import { HanjinConfig, isHanjinConfigured } from './hanjin.config';
import type { HanjinApiClient } from './hanjin-api.client';

const LABEL_FIELDS = [
  's_tml_nam',
  's_tml_cod',
  'zip_cod',
  'tml_nam',
  'tml_cod',
  'cen_nam',
  'cen_cod',
  'pd_tim',
  'dom_rgn',
  'hub_cod',
  'dom_mid',
  'grp_rnk',
  'es_nam',
  'es_cod',
  'prt_add',
] as const;

// 시간이 지나면 저절로 풀리는 print-wbl 결과코드 (정본 §4.1). 이 표에 없는 ERROR-xx 는 전부 영구 거절이다.
// 값은 재시도 시점 힌트 — ERROR-05 는 한도가 «일 단위»로 리셋되므로 같은 날 다시 불러봐야 의미가 없고,
// ERROR-06 은 통제 해제 시점이 미상이라 짧게 잡아 다음 배치에서 다시 부딪혀 보게 한다.
const TRANSIENT_PRINT_WBL_CODES: Record<string, RetryAfter> = {
  'ERROR-05': { kind: 'next_day' }, // 일일 운송장 출력 한도 초과 (고객별 한도물량)
  'ERROR-06': { kind: 'after_ms', ms: 60 * 60 * 1000 }, // 불가항력 지역 출력 통제
};

// print-wbl 응답(snake_case). 분류필드는 인덱스 시그니처로 접근.
interface PrintWblResponse {
  result_code?: string;
  result_message?: string;
  wbl_num?: string | number;
  [key: string]: unknown;
}

// insert-order 응답(camelCase)
interface InsertOrderResponse {
  resultCode?: string;
  resultMessage?: string;
}

const STATUS_MAP: Record<string, CarrierScanStatus> = {
  '01': 'pending',
  '05': 'pending',
  '07': 'in_transit',
  '08': 'in_transit',
  '11': 'in_transit',
  '14': 'in_transit',
  '31': 'in_transit',
  '32': 'in_transit',
  '63': 'in_transit',
  '65': 'delivered',
  '66': 'delivered',
  '92': 'failed',
  '03': 'canceled',
};

// tracking-wbl 응답(camelCase)
interface TrackingWblItem {
  statusCode?: string;
  statusDate?: string;
  agencyName?: string;
  description?: string;
  reasonCode?: string;
  reasonMessage?: string;
}
interface TrackingWblResponse {
  resultCode?: string;
  wrkList?: TrackingWblItem[];
}

export class HanjinCarrierGateway extends CarrierGateway {
  override readonly carrier: CarrierCode = 'HANJIN';
  override readonly capabilities: CarrierCapabilities = Object.freeze({
    allocatesExternally: true,
    registersSeparately: true,
    canTrack: true,
    canCancel: false,
  });

  constructor(
    private readonly config: HanjinConfig,
    private readonly client: HanjinApiClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  override isConfigured(): boolean {
    return isHanjinConfigured(this.config);
  }

  override async allocate(req: WaybillRequest): Promise<AllocateResult> {
    const body = {
      client_id: this.config.clientId,
      csr_num: this.config.contractNo,
      address: `${req.recipient.baseAddress} ${req.recipient.detailAddress}`.trim(),
      snd_zip: req.sender.zip,
      rcv_zip: req.recipient.zip,
      msg_key: req.custOrdNo,
    };
    const res = await this.client.post<PrintWblResponse>('print', `/v1/wbl/${this.config.clientId}/print-wbl`, body);
    if (res?.result_code !== 'OK' || !res?.wbl_num) {
      // 구체 오류코드(ERROR-xx) 보존; OK 인데 wbl_num 만 없는 경우에만 no_wbl_num.
      const code = res?.result_code && res.result_code !== 'OK' ? res.result_code : 'no_wbl_num';
      const retryAfter = TRANSIENT_PRINT_WBL_CODES[code];
      throw new CarrierError(
        `Hanjin print-wbl rejected: ${res?.result_code} - ${res?.result_message ?? ''}`,
        retryAfter ? 'transient_rejection' : 'definitive_rejection',
        { carrier: 'hanjin', code, ...(retryAfter ? { retryAfter } : {}) },
      );
    }
    const labelData: Record<string, unknown> = {};
    for (const f of LABEL_FIELDS) if (res[f] !== undefined) labelData[f] = res[f];
    return { waybillNo: String(res.wbl_num), labelData };
  }

  override async register(waybillNo: string, req: WaybillRequest): Promise<RegisterOutcome> {
    const body = {
      custEdiCd: this.config.clientId,
      custOrdNo: req.custOrdNo,
      wblNo: waybillNo,
      svcCatCd: 'S',
      cntractNo: this.config.contractNo,
      pickupAskDt: this.kstDate(this.now()),
      sndrZip: req.sender.zip,
      sndrBaseAddr: req.sender.baseAddress,
      sndrDtlAddr: req.sender.detailAddress,
      sndrNm: req.sender.name,
      // 송하인은 폴백할 두 번째 번호가 없다. 빈 값이 나가지 않는 것은 isHanjinConfigured 가
      // HANJIN_SENDER_TEL 을 필수로 보기 때문이다(#912) — 게이트를 좁히면 여기가 다시 빈다.
      sndrTelNo: req.sender.tel ?? '',
      rcvrZip: req.recipient.zip,
      rcvrBaseAddr: req.recipient.baseAddress,
      rcvrDtlAddr: req.recipient.detailAddress,
      rcvrNm: req.recipient.name,
      // §4.2 19번 rcvrTelNo 는 필수, 20번 rcvrMobileNo 는 선택이다. 커머스 주문은 연락처가 휴대폰
      // 하나뿐이므로 tel 이 비면 mobile 로 폴백한다 — 비워 보내면 ERROR-01 로 전건 거절된다.
      // 두 필드는 배타가 아니므로 폴백해도 mobile 을 비우지 않는다.
      rcvrTelNo: req.recipient.tel || req.recipient.mobile || '',
      rcvrMobileNo: req.recipient.mobile ?? '',
      rcvrAskCntent: req.recipient.message ?? '',
      comodityNm: req.commodityName,
      payTypCd: req.payType,
      boxTypCd: req.boxType,
      comodityList: req.items.map((it) => ({
        comodityCd: it.code ?? '',
        comodityNm: it.name,
        comodityCnt: String(it.quantity),
      })),
    };
    const res = await this.client.post<InsertOrderResponse>('order', '/parcel-delivery/v1/order/insert-order', body);
    if (res?.resultCode === 'OK') return { kind: 'registered' };
    if (res?.resultCode === 'ERROR-09') return { kind: 'already_registered' };
    return { kind: 'rejected', reason: `${res?.resultCode ?? 'UNKNOWN'}: ${res?.resultMessage ?? ''}`.trim() };
  }

  override async track(waybillNo: string): Promise<CarrierScan[]> {
    const res = await this.client.post<TrackingWblResponse>('order', '/parcel-delivery/v1/tracking/tracking-wbl', {
      custEdiCd: this.config.clientId,
      wblNo: waybillNo,
    });
    if (res?.resultCode === 'ERROR-01') return [];
    const list: TrackingWblItem[] = Array.isArray(res?.wrkList) ? res.wrkList : [];
    return list.map((w) => ({
      statusCode: String(w.statusCode ?? ''),
      status: STATUS_MAP[String(w.statusCode)] ?? 'pending',
      occurredAt: new Date(String(w.statusDate ?? '').replace(' ', 'T') + '+09:00'),
      location: w.agencyName || undefined,
      description: w.description || undefined,
      reasonCode: w.reasonCode || undefined,
      reasonMessage: w.reasonMessage || undefined,
    }));
  }

  private kstDate(d: Date): string {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)!.value;
    return `${get('year')}${get('month')}${get('day')}`;
  }
}
