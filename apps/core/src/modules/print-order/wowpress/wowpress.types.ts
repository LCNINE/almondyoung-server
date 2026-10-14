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

export interface WowpressOrderInput {
  spec: WowpressLineSpec;
  qty: number;
  ordtitle: string;
  ordbody: string;
  ordkey: string;
  receiver: WowpressReceiver;
}

export interface WowpressOrderDetail {
  ordstat: number;
  jobstat: number | null;
  dlvyno: number | null;
  dlvyinvc: string | null;
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
