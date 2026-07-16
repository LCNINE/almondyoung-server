// 경로 주의: 이 파일은 fulfillment/waybill/carrier/ 에 있으므로 inventory 까지 3단계 상위(../../../).
import { carrierEnum } from '../../../inventory/schema/inventory.schema';

export type CarrierCode = (typeof carrierEnum.enumValues)[number];

export interface WaybillRequest {
  custOrdNo: string; // ≤30B, 우리 상관키(주문번호)
  recipient: {
    name: string; zip: string; baseAddress: string; detailAddress: string;
    tel?: string; mobile?: string; message?: string;
  };
  sender: { name: string; zip: string; baseAddress: string; detailAddress: string; tel?: string };
  items: Array<{ name: string; code?: string; quantity: number }>;
  commodityName: string; // comodityNm 요약(대표 상품명)
  boxType: string;       // boxTypCd
  payType: string;       // payTypCd
}

export interface AllocateResult {
  waybillNo: string;
  labelData: Record<string, unknown>; // carrier-tagged blob (한진 분류필드)
}

export type RegisterOutcome =
  | { kind: 'registered' }
  | { kind: 'already_registered' } // 한진 ERROR-09 → 멱등 성공
  | { kind: 'rejected'; reason: string };

export type CarrierScanStatus = 'pending' | 'in_transit' | 'delivered' | 'failed' | 'canceled';

export interface CarrierScan {
  statusCode: string;
  status: CarrierScanStatus;
  occurredAt: Date;
  location?: string;
  description?: string;
  reasonCode?: string;
  reasonMessage?: string;
}

export type CarrierErrorOutcome = 'definitive_rejection' | 'unknown_outcome';

export class CarrierError extends Error {
  override readonly name = 'CarrierError';
  constructor(
    message: string,
    readonly outcome: CarrierErrorOutcome,
    readonly details: { carrier?: string; code?: string; httpStatus?: number; cause?: unknown } = {},
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
