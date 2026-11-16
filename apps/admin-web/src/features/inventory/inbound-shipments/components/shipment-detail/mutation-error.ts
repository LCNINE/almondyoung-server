import { isValidationRejection } from '../../lib/upload-error-message';

export const INVALID_INPUT_MESSAGE = '입력값이 올바르지 않습니다.';

/** 쓰기 실패 문구 — 검증 400 은 일반 문구, 그 밖에는 서버 문구(한국어 도메인 메시지·409)를 그대로 쓴다. */
export function writeErrorMessage(error: unknown): string {
  if (isValidationRejection(error)) return INVALID_INPUT_MESSAGE;
  if (error instanceof Error && error.message) return error.message;
  return '저장하지 못했습니다.';
}
