import { isCustomError } from '@/lib/api/customError';

export const SHAPE_LIMIT_MESSAGE = '파일 모양이 한도를 넘습니다(열 64개·행 5,000개·칸 2,000자).';

/**
 * 올리기 실패의 사유 문구. client 는 4xx 를 CustomError{message, statusCode, response=원본 본문} 로 던진다.
 * class-validator 400(본문 message 가 배열)은 한도 안내로, core 의 한국어 문구(문자열)는 message 그대로.
 * 원본 보관(file-service) 실패의 cause 도 Error 이므로 같은 길로 message 를 읽는다.
 */
export function uploadErrorMessage(error: unknown): string {
  if (isCustomError(error) && error.statusCode === 400) {
    const body: unknown = error.response;
    const bodyMessage =
      body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    if (Array.isArray(bodyMessage)) return SHAPE_LIMIT_MESSAGE;
  }
  if (error instanceof Error && error.message) return error.message;
  return '올리지 못했습니다.';
}
