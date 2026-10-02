/**
 * 관리자 알림톡 대량 발송 행의 providerId. NHN 알림톡 프로바이더 id 와 일부러 다르게 둔다 —
 * 이벤트 알림의 직접 발송 행과 섞이지 않고, 문자(발송폰) 디스패처도 providerId 로 걸러 이 행을 집지 않는다.
 */
export const ALIMTALK_CAMPAIGN_PROVIDER_ID = '7c1e9d42-5a3b-4f6e-8b20-4d9a6c3e1f58';

/** NHN 치환 발송 한 요청의 수신자 상한 */
export const ALIMTALK_BATCH_SIZE = 1000;

/** 이 시간 넘게 PROCESSING 인 행은 발송 요청 도중 프로세스가 죽은 것으로 본다 (NHN 요청 타임아웃 30초) */
export const ALIMTALK_STALE_PROCESSING_MS = 10 * 60 * 1000;

export const ALIMTALK_CAMPAIGN_LIST_LIMIT = 50;

/** 결과 화면에 보여 줄 실패 건 수 */
export const ALIMTALK_FAILURE_SAMPLE = 50;

export const ALIMTALK_CAMPAIGN_PROVIDER = 'alimtalk';
