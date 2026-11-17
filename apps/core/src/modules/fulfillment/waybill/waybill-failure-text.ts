import { WAYBILL } from './waybill.constants';

// 송장 행의 last_error 는 운영 기록이라 영문 단계·코드로 남는다(waybill-issue.machine).
// 작업자 화면에는 원인과 다음 행동을 한국어로 보이고, 운송사 코드는 문의할 때 쓰도록 괄호로 남긴다.
// 운송사 쪽 결과를 모르는 경우(응답 없음·예상 밖 오류)는 실패로 단정하지 않는다.

export interface WaybillFailureFacts {
  status: string;
  lastError: string | null;
}

const CHECK_BOX = '상자 화면에서 송장 상태를 확인해요';
const CARRIER_CODE = /^[A-Za-z0-9_.-]+$/;
const TRANSIENT = /^(allocate|register) (\S+): transient, retry after (\S+)$/;
const TRANSIENT_CAP = new RegExp(`^(allocate|register) (\\S+): ${WAYBILL.ERROR.TRANSIENT_CAP_EXCEEDED} \\(\\d+\\)$`);
const REGISTER_REJECTED = /^register rejected: ?(.*)$/;
const PHASE_CODE = /^(allocate|register) (.+)$/;

function withCode(text: string, code: string | undefined): string {
  return code ? `${text} (${code})` : text;
}

function kstTime(iso: string): string | null {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return null;
  }

  return at.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 상태가 먼저다 — 행은 다음 단계로 넘어가도 앞 단계의 last_error 를 지우지 않는다.
export function waybillFailureText({ status, lastError }: WaybillFailureFacts): string | null {
  const error = lastError?.trim() ?? '';

  switch (status) {
    case 'pending':
      return pendingText(error);
    case 'allocated':
      return `운송사 응답을 확인하지 못했어요 — ${CHECK_BOX}`;
    case 'abandoned':
      return error.startsWith('abandoned by operator:')
        ? '송장 발급을 중단했어요 — 상자 화면에서 다시 발급해요'
        : `운송사 응답을 확인하지 못해 발급을 멈췄어요 — ${CHECK_BOX}`;
    case 'failed':
      return failedText(error);
    default:
      return null;
  }
}

function pendingText(error: string): string {
  const transient = TRANSIENT.exec(error);

  if (!transient) {
    return `운송사 응답을 확인하지 못했어요 — ${CHECK_BOX}`;
  }

  const at = kstTime(transient[3]);

  return `${withCode('운송사가 지금은 받지 않아요', transient[2])} — ${at ? `${at} 이후 ` : ''}다시 시도해요`;
}

function failedText(error: string): string {
  if (error.startsWith(`${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}:`)) {
    return withCode(
      '운송사 연결이 설정되지 않았어요',
      error.slice(WAYBILL.ERROR.CARRIER_NOT_CONFIGURED.length + 1).trim(),
    );
  }

  const capped = TRANSIENT_CAP.exec(error);

  if (capped) {
    return `${withCode('운송사가 여러 번 받지 않았어요', capped[2])} — 상자 화면에서 다시 발급해요`;
  }

  const rejected = REGISTER_REJECTED.exec(error);

  if (rejected) {
    return `${withCode('운송사가 송장 접수를 거절했어요', rejected[1].trim() || undefined)} — 상자 화면에서 확인해요`;
  }

  const phase = PHASE_CODE.exec(error);

  if (phase && CARRIER_CODE.test(phase[2])) {
    const text = phase[1] === 'allocate' ? '운송사가 송장 번호를 주지 않았어요' : '운송사가 송장 접수를 거절했어요';

    return `${withCode(text, phase[2])} — 상자 화면에서 확인해요`;
  }

  return `송장 발급 중 오류가 났어요 — ${CHECK_BOX}`;
}
