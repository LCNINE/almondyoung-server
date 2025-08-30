export type UUID = string; // UUIDv7 사용 예정
export type ULID = string;

export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: object;
  };
  timestamp: string;
  path: string;
}
