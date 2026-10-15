export interface WowpressLineSpec {
  prodno: number;
  jobpresetno: string;
  prsjob: Record<string, unknown>[];
  awkjob: Record<string, unknown>[];
  qtyPerUnit: number;
  file: { format: 'jpg' | 'pdf' | 'eps'; dpi: number };
  confirmed: boolean;
}

export interface WowpressReceiver {
  name: string;
  tel: string;
  zipcode: string;
  addr1: string;
  addr2: string;
  dlvymsg: string;
}

export interface WowpressOrderItem {
  spec: WowpressLineSpec;
  qty: number;
  ordbody: string;
  ordkey: string;
}

export interface WowpressOrderInput {
  items: WowpressOrderItem[];
  ordtitle: string;
  receiver: WowpressReceiver;
}

export interface WowpressPlacedOrder {
  ordnum: string;
  dboxno: number | null;
  prodno: number | null;
}

export interface WowpressBox {
  dboxno: number;
  dboxnum: string | null;
  shippingFee: number | null;
}

export interface WowpressOrderResult {
  orders: WowpressPlacedOrder[];
  boxes: WowpressBox[];
}

export interface WowpressOrderDetail {
  ordstat: number;
  jobstat: number | null;
  carrierCode: number | null;
  trackingNumber: string | null;
  boxNumber: string | null;
}

export interface WowpressRequest {
  method: 'GET' | 'POST';
  url: string;
  json?: unknown;
  form?: Record<string, string>;
  token?: string;
}

export interface WowpressResponse {
  status: number;
  body: unknown;
}

export type WowpressTransport = (req: WowpressRequest) => Promise<WowpressResponse>;

export const WOWPRESS_STATUS_CANCELLED = 90;

export const WOWPRESS_CANCELLABLE = (d: WowpressOrderDetail): boolean =>
  d.ordstat === 0 || d.ordstat === 1 || d.jobstat === 109;

export const WOWPRESS_CARRIER: Record<number, 'LOTTE' | 'CJ'> = { 109: 'LOTTE', 156: 'CJ' };
