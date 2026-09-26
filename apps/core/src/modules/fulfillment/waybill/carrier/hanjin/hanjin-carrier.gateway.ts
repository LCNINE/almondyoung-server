import { Logger } from '@nestjs/common';
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

// tracking-wbl 작업상태코드 (정본 §4.4). 공식 목록은 이 12개가 전부다 — 여기 없는 코드는 `unknown` 으로
// 떨어뜨리고 경고를 남긴다(한진이 코드를 늘릴 수 있다). `65` 같은 비공식 코드를 추측으로 넣지 말 것.
const STATUS_MAP: Record<string, CarrierScanStatus> = {
  '01': 'pending', // 예약등록
  '03': 'canceled', // 예약취소
  '05': 'pending', // 운송장출력
  '07': 'in_transit', // 집하출발
  '08': 'pickup_missed', // 미집하 — 진행 중이 아니라 예외 상태
  '11': 'in_transit', // 집하완료
  '14': 'in_transit', // 입고
  '31': 'in_transit', // 상품출발
  '32': 'in_transit', // 상품도착
  '63': 'in_transit', // 배송출발
  '66': 'delivered', // 배송완료
  '92': 'failed', // 배송불가
};

// 작업상태별 사유코드 해석 (정본 §4.4). 같은 코드라도 작업상태마다 뜻이 다르다 — 66 은 사유가 아니라
// 인수 관계다. ⚠️ 이 코드가 응답의 `reasonCode` 필드로 온다는 것은 정본에 없는 추정이다(첫 실스캔 전까지
// 실측 불가 — DEV 는 집하 전 ERROR-01 만 준다). 그래서 표에 없으면 한진 원문 `reasonMessage` 로 폴백한다.
const REASON_LABELS: Record<string, Record<string, string>> = {
  '03': {
    '01': '송하인부재',
    '02': '화물미준비 및 재고부족',
    '03': '취급불가 화물',
    '04': '송하인 발송취소',
    '05': '고객분실',
    '06': '기 집하',
    '07': '고객 파손',
    '08': '타인 양도',
    '09': '반품지시 부정확',
    '10': '주소 불명',
    '11': '고객 이사 및 퇴사',
    '12': '타 운송자 집하',
    '18': '기업체휴무',
    '99': '기타',
  },
  '92': {
    '01': '수취거부',
    '02': '수하인 이사',
    '04': '악천후',
    '05': '수하인 주소 부정확',
    '06': '고객부재',
    '07': '관세지불 거절',
    '08': '송하인 요청',
    '17': '기업체 휴무',
    '99': '기타',
  },
  '66': {
    '01': '본인',
    '02': '가족',
    '03': '직장동료',
    '04': '이웃',
    '05': '경비실',
    '06': '문앞',
    '99': '기타',
  },
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
  private readonly logger = new Logger(HanjinCarrierGateway.name);
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
    return list.map((w) => {
      const statusCode = String(w.statusCode ?? '');
      const reasonCode = w.reasonCode || undefined;
      const reasonMessage = w.reasonMessage || undefined;
      return {
        statusCode,
        status: this.scanStatus(waybillNo, statusCode),
        occurredAt: new Date(String(w.statusDate ?? '').replace(' ', 'T') + '+09:00'),
        location: w.agencyName || undefined,
        description: w.description || undefined,
        reasonCode,
        reasonMessage,
        reasonLabel: (reasonCode && REASON_LABELS[statusCode]?.[reasonCode]) || reasonMessage,
      };
    });
  }

  private scanStatus(waybillNo: string, statusCode: string): CarrierScanStatus {
    const status = STATUS_MAP[statusCode];
    if (status) return status;
    this.logger.warn(
      `한진 tracking-wbl 에 알 수 없는 작업상태코드 ${JSON.stringify(statusCode)} (운송장 ${waybillNo})`,
    );
    return 'unknown';
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
