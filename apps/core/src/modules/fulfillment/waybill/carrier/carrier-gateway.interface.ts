// 경로 주의: 이 파일은 fulfillment/waybill/carrier/ 에 있으므로 inventory 까지 3단계 상위(../../../).
import { carrierEnum } from '../../../inventory/schema/inventory.schema';

export type CarrierCode = (typeof carrierEnum.enumValues)[number];

export interface WaybillRequest {
  custOrdNo: string; // ≤30B, 우리 상관키(주문번호)
  recipient: {
    name: string;
    zip: string;
    baseAddress: string;
    detailAddress: string;
    tel?: string;
    mobile?: string;
    message?: string;
  };
  sender: { name: string; zip: string; baseAddress: string; detailAddress: string; tel?: string };
  items: Array<{ name: string; code?: string; quantity: number }>;
  commodityName: string; // comodityNm 요약(대표 상품명)
  boxType: string; // boxTypCd
  payType: string; // payTypCd
}

export interface AllocateResult {
  waybillNo: string;
  labelData: Record<string, unknown>; // carrier-tagged blob (한진 분류필드)
}

export type RegisterOutcome =
  | { kind: 'registered' }
  | { kind: 'already_registered' } // 한진 ERROR-09 → 멱등 성공
  | { kind: 'rejected'; reason: string };

/**
 * - `pickup_missed`: 집하가 이뤄지지 않은 예외 상태(한진 08 미집하). 다시 집하되면 `in_transit` 으로
 *   넘어가므로 종료 상태인 `failed`(배송불가)와 섞지 말 것 — 섞으면 미집하 적체를 볼 수 없다.
 * - `unknown`: 캐리어가 우리 표에 없는 코드를 보냈다. 소비자는 이 스캔을 «건너뛰어야» 한다 —
 *   `pending` 으로 읽으면 이미 배송 중인 운송장이 뒤로 가는 것처럼 보인다.
 */
export type CarrierScanStatus =
  | 'pending'
  | 'in_transit'
  | 'pickup_missed'
  | 'delivered'
  | 'failed'
  | 'canceled'
  | 'unknown';

export interface CarrierScan {
  statusCode: string;
  status: CarrierScanStatus;
  occurredAt: Date;
  location?: string;
  description?: string;
  reasonCode?: string;
  reasonMessage?: string;
  /** 사유(또는 배송완료의 인수 관계)를 사람이 읽을 말로 푼 것. 캐리어 원문은 `reasonMessage` 에 그대로 남는다. */
  reasonLabel?: string;
}

/**
 * `transient_rejection` 은 «확실히 거절됐지만 시간이 지나면 풀리는» 사유다 (한진 ERROR-05 일일
 * 출력한도 / ERROR-06 지역통제). `unknown_outcome`(타임아웃·5xx = 채번이 됐는지 모른다)과 섞지 말 것 —
 * 의미가 반대이고, 상태머신이 소모하는 카운터도 다르다.
 */
export type CarrierErrorOutcome = 'definitive_rejection' | 'transient_rejection' | 'unknown_outcome';

/**
 * 언제 다시 시도해도 되는지에 대한 캐리어의 힌트. «얼마나 기다려야 하는가»는 캐리어만 아는 지식이라
 * (ERROR-05 는 일 단위, ERROR-06 은 미상) 상태머신이 코드별 분기를 갖지 않도록 게이트웨이가 실어 보낸다.
 * 상태머신은 이걸 시각으로 환산만 한다.
 */
export type RetryAfter =
  | { kind: 'next_day' } // 다음 날(KST) 이후. 일 단위로 리셋되는 한도에 쓴다.
  | { kind: 'after_ms'; ms: number };

export class CarrierError extends Error {
  override readonly name = 'CarrierError';
  constructor(
    message: string,
    readonly outcome: CarrierErrorOutcome,
    readonly details: {
      carrier?: string;
      code?: string;
      httpStatus?: number;
      cause?: unknown;
      /** `transient_rejection` 일 때만 의미가 있다. 없으면 상태머신이 기본 백오프를 쓴다. */
      retryAfter?: RetryAfter;
    } = {},
  ) {
    super(message);
  }
}

export interface CarrierCapabilities {
  allocatesExternally: boolean; // 외부 채번(print-wbl)
  registersSeparately: boolean; // 별도 등록(insert-order)
  canTrack: boolean;
  canCancel: boolean;
}

export abstract class CarrierGateway {
  abstract readonly carrier: CarrierCode;
  abstract readonly capabilities: CarrierCapabilities;
  abstract isConfigured(): boolean;
  abstract allocate(req: WaybillRequest): Promise<AllocateResult>;
  abstract register(waybillNo: string, req: WaybillRequest): Promise<RegisterOutcome>;
  track?(waybillNo: string): Promise<CarrierScan[]>;
  cancel?(waybillNo: string, req: WaybillRequest): Promise<void>;
}
