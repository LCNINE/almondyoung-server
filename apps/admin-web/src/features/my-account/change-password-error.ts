import { CustomError } from '@/lib/api/customError';

const GENERIC = '비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.';

/**
 * 비밀번호 변경 실패 문구. 서버가 이유를 들어 거절한 경우(4xx — 형식 규칙, 현재 비밀번호 불일치)는
 * 그 문장을 그대로 보여준다. 고정 문구만 띄우면 규칙 위반도 「현재 비밀번호를 확인」으로 보여 원인을 못 찾는다.
 * 네트워크 실패는 클라이언트가 statusCode 500 으로 만든다.
 */
export function changePasswordErrorMessage(error: unknown): string {
  if (
    error instanceof CustomError &&
    error.statusCode < 500 &&
    error.message.trim()
  ) {
    return error.message;
  }
  return GENERIC;
}
