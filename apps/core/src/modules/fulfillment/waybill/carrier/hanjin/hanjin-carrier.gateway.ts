import {
  AllocateResult,
  CarrierCapabilities,
  CarrierCode,
  CarrierError,
  CarrierGateway,
  CarrierScan,
  CarrierScanStatus,
  RegisterOutcome,
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
      throw new CarrierError(
        `Hanjin print-wbl rejected: ${res?.result_code} - ${res?.result_message ?? ''}`,
        'definitive_rejection',
        { carrier: 'hanjin', code: res?.result_code ?? 'no_wbl_num' },
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
      sndrTelNo: req.sender.tel ?? '',
      rcvrZip: req.recipient.zip,
      rcvrBaseAddr: req.recipient.baseAddress,
      rcvrDtlAddr: req.recipient.detailAddress,
      rcvrNm: req.recipient.name,
      rcvrTelNo: req.recipient.tel ?? '',
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
