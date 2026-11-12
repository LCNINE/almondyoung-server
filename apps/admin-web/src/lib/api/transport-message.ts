// 응답이 없거나 서버 오류일 때 관리자에게 보일 문장. 통신 라이브러리의 원문
// («Request failed with status code 500» 등)은 보이지 않는다.

export const NO_CONNECTION_MESSAGE =
  '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 잠시 뒤 다시 시도해 주세요.';
export const SERVER_BUSY_MESSAGE =
  '서버가 잠시 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.';
export const SERVER_ERROR_MESSAGE =
  '서버에서 문제가 생겨 처리하지 못했어요. 잠시 뒤 다시 시도하고, 계속되면 개발팀에 알려 주세요.';
export const UNKNOWN_RESULT_MESSAGE =
  '응답을 받지 못해 처리됐는지 알 수 없어요. 새로고침해 결과를 확인한 뒤 다시 해 주세요.';

// 서버가 거절했는데 이유를 적지 않았을 때
export const REJECTED_MESSAGE =
  '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.';

const READ_METHODS = new Set(['get', 'head', 'options']);
const HANGUL = /[가-힣]/;

// 서버가 우리 오류 형식(코드 포함)으로 답했는지 — 아니면 응답이 없거나 중간 게이트웨이가 답한 것이다
function answeredMessage(data: unknown): string | null | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const body = data as {
    code?: unknown;
    errorCode?: unknown;
    message?: unknown;
  };
  const code = body.code ?? body.errorCode;
  if (typeof code !== 'string') return undefined;
  return typeof body.message === 'string' && HANGUL.test(body.message)
    ? body.message
    : null;
}

export function failureMessage({
  method,
  status,
  data,
}: {
  method?: string;
  status?: number;
  data?: unknown;
}): string {
  const answered = answeredMessage(data);
  if (answered !== undefined) return answered ?? SERVER_ERROR_MESSAGE;

  if (!READ_METHODS.has((method ?? 'get').toLowerCase())) {
    return UNKNOWN_RESULT_MESSAGE;
  }
  if (status === undefined) return NO_CONNECTION_MESSAGE;
  return status === 502 || status === 503 || status === 504
    ? SERVER_BUSY_MESSAGE
    : SERVER_ERROR_MESSAGE;
}
