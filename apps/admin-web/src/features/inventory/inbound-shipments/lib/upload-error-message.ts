import { isCustomError } from '@/lib/api/customError';

export const SHAPE_LIMIT_MESSAGE =
  '파일 모양이 한도를 넘습니다(열 64개·행 5,000개·칸 2,000자).';

/**
 * ValidationPipe(class-validator)가 거절한 400 인가. core GlobalExceptionFilter 는 Nest 의 message 배열을
 * 첫 문자열로 평탄화해 보내므로 본문 모양으로는 알 수 없고, BadRequestException 의 error 필드가 실린
 * code === 'Bad Request' 로 가른다. 도메인 BadRequestError 는 code === 'BAD_REQUEST'.
 */
export function isValidationRejection(error: unknown): boolean {
  if (!isCustomError(error) || error.statusCode !== 400) return false;
  const body: unknown = error.response;
  return (
    !!body &&
    typeof body === 'object' &&
    (body as { code?: unknown }).code === 'Bad Request'
  );
}

/**
 * 올리기 실패의 사유 문구. client 는 4xx 를 CustomError{message, statusCode, response=원본 본문} 로 던진다.
 * 검증 400 은 한도 안내로, core 의 한국어 문구는 message 그대로.
 * 원본 보관(file-service) 실패의 cause 도 Error 이므로 같은 길로 message 를 읽는다.
 */
export function uploadErrorMessage(error: unknown): string {
  if (isValidationRejection(error)) return SHAPE_LIMIT_MESSAGE;
  if (error instanceof Error && error.message) return error.message;
  return '올리지 못했습니다.';
}
