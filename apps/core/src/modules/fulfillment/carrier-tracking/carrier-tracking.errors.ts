import { ConflictError } from '@app/shared';

/** 화면이 본 뒤 택배사 상태나 확인 기록이 바뀌었다 — 다시 불러와 확인해야 한다 */
export class CarrierTrackingChangedError extends ConflictError {
  constructor(dispatchAttemptId: string) {
    super(`Carrier tracking changed for dispatch attempt ${dispatchAttemptId}`);
  }

  getErrorCode(): string {
    return 'CARRIER_TRACKING_CHANGED';
  }
}

/** 확인할 일이 아니다 — 그 사이 스캔이 생겼거나 되돌려졌다 */
export class CarrierTrackingNotNeededError extends ConflictError {
  constructor(dispatchAttemptId: string) {
    super(`Carrier tracking needs no confirmation for dispatch attempt ${dispatchAttemptId}`);
  }

  getErrorCode(): string {
    return 'CARRIER_TRACKING_NOT_NEEDED';
  }
}

export class CarrierNotTrackableError extends ConflictError {
  constructor(dispatchAttemptId: string) {
    super(`Dispatch attempt ${dispatchAttemptId} has no waybill the carrier can be asked about`);
  }

  getErrorCode(): string {
    return 'CARRIER_NOT_TRACKABLE';
  }
}
