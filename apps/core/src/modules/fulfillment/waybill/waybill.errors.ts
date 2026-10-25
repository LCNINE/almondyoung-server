/** 살아 있는 송장에 같은 송장번호가 있다(`uq_waybills_tracking_live`). 호출자가 자기 도메인 에러로 옮긴다. */
export class WaybillTrackingLiveConflictError extends Error {}
