export interface WowpressLineSpec {
  prodno: number;
  jobpresetno: string;
  prsjob: Record<string, unknown>[];
  awkjob: Record<string, unknown>[];
  qtyPerUnit: number;
  file: { format: 'jpg' | 'pdf' | 'eps'; dpi: number };
  // 이 품목에 맞는 시안. 시안 ID 는 장바구니 메타데이터로 들어와 고객이 다른 상품·크기의 시안을 붙일 수 있다
  design: { productId: string; widthMm: number; heightMm: number };
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

export const WOWPRESS_STATUS_AWAITING_PAYMENT = 0;
export const WOWPRESS_STATUS_CANCELLED = 90;

// 작업상태(JobStat) 중 접수에러·파일에러. 와우프레스 화면에서 파일재접수나 취소로 풀어야 생산이 이어진다
export const WOWPRESS_JOB_ERRORS: ReadonlySet<number> = new Set([109, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131]);

export const WOWPRESS_CANCELLABLE = (d: WowpressOrderDetail): boolean =>
  d.ordstat === 0 || d.ordstat === 1 || d.jobstat === 109;

export const WOWPRESS_CARRIER: Record<number, 'LOTTE' | 'CJ'> = { 109: 'LOTTE', 156: 'CJ' };

export interface WowpressProdInfo {
  prodno: number;
  prodname: string;
  filetype: string | null;
  sizeinfo?: unknown;
  paperinfo?: unknown;
  colorinfo?: unknown;
  ordqty?: unknown;
  prsjobinfo?: unknown;
  awkjobinfo?: unknown;
  dlvyprepay: boolean | null;
  dlvygrpno: number | null;
}
