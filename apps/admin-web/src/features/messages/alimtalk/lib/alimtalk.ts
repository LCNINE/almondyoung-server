import type {
  AlimtalkAutoSendResult,
  AlimtalkButtonInput,
  AlimtalkTemplateStatus,
  AlimtalkVariableBinding,
} from '@/lib/api/domains/alimtalk';

export const STATUS_LABEL: Record<AlimtalkTemplateStatus, string> = {
  TSC01: '심사 요청',
  TSC02: '검수 중',
  TSC03: '승인',
  TSC04: '반려',
};

export const COMMENT_STATUS_LABEL: Record<string, string> = {
  INQ: '문의',
  APR: '승인',
  REJ: '반려',
  REP: '답변',
  REQ: '검수 중',
};

export const LIMITS = {
  code: 20,
  name: 150,
  content: 1300,
  buttons: 5,
  buttonName: 14,
  link: 500,
} as const;

const VARIABLE = /#\{([^{}]+)\}/g;

/** 본문과 버튼 링크의 #{변수} 를 처음 나온 순서대로 한 번씩. 서버와 같은 규칙이다. */
export function extractVariables(
  content: string,
  buttons: { linkMo?: string | null; linkPc?: string | null }[] = []
) {
  const names: string[] = [];
  for (const text of [
    content,
    ...buttons.flatMap((b) => [b.linkMo ?? '', b.linkPc ?? '']),
  ]) {
    for (const match of text.matchAll(VARIABLE)) {
      const name = match[1].trim();
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export function renderVariables(
  content: string,
  values: Record<string, string>
): string {
  return content.replace(
    VARIABLE,
    (whole, name: string) => values[name.trim()] || whole
  );
}

/** 이름처럼 보이는 변수는 기본으로 «받는 사람 이름» 에 묶는다. */
export function defaultBinding(name: string): AlimtalkVariableBinding {
  return /^(name|username|이름|고객명|회원명)$/i.test(name)
    ? { name, source: 'RECIPIENT_NAME' }
    : { name, source: 'FIXED', value: '' };
}

export interface TemplateFormValues {
  templateCode: string;
  templateName: string;
  templateContent: string;
  categoryCode: string;
  buttons: AlimtalkButtonInput[];
}

/** 카카오 등록 규격을 보내기 전에 화면에서 먼저 막는다. 문제 없으면 빈 배열. */
export function validateTemplateForm(
  values: TemplateFormValues,
  isCreate: boolean
): string[] {
  const errors: string[] = [];
  if (isCreate && !/^[A-Za-z0-9_]{1,20}$/.test(values.templateCode)) {
    errors.push('템플릿 코드는 영문·숫자·밑줄로 20자까지 쓸 수 있습니다');
  }
  if (!values.templateName.trim()) errors.push('템플릿 이름을 넣으세요');
  if (!values.templateContent.trim()) errors.push('본문을 넣으세요');
  if (values.templateContent.length > LIMITS.content)
    errors.push(`본문은 ${LIMITS.content}자까지입니다`);
  if (!/^\d{6}$/.test(values.categoryCode)) errors.push('카테고리를 고르세요');
  if (values.buttons.length > LIMITS.buttons)
    errors.push(`버튼은 ${LIMITS.buttons}개까지입니다`);
  values.buttons.forEach((b, i) => {
    if (!b.name.trim() || b.name.length > LIMITS.buttonName)
      errors.push(`버튼 ${i + 1}: 이름은 1~${LIMITS.buttonName}자입니다`);
    if (!/^https?:\/\//.test(b.linkMo.trim()))
      errors.push(
        `버튼 ${i + 1}: 링크는 http:// 나 https:// 로 시작해야 합니다`
      );
  });
  return errors;
}

/** "번호, 이름" 을 한 줄에 하나씩. 쉼표·탭·공백 뒤를 이름으로 본다. */
export function parseManualRecipients(
  text: string
): { phone: string; name?: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phone, ...rest] = line.split(/[,\t]/);
      const name = rest.join(' ').trim();
      return name ? { phone: phone.trim(), name } : { phone: phone.trim() };
    });
}

/** 서버는 못 받은 분을 앞에서부터 일부만 돌려준다. 전체 인원은 결과 집계의 `failed` 다. */
export function failureListTitle(failed: number, shown: number): string {
  const total = `못 받은 분 ${failed.toLocaleString()}명`;
  return shown < failed
    ? `${total} (앞의 ${shown.toLocaleString()}명만 표시)`
    : total;
}

/** 자동 알림 상세에서 연결된 템플릿 상태를 한 줄로. 목록 조회는 끝났는데 코드가 없으면 `null` 이다. */
export function linkedTemplateNote(
  found: { status: AlimtalkTemplateStatus } | null
): string {
  if (!found) {
    return '카카오(NHN)에 이 코드의 템플릿이 없습니다. 켜도 알림톡이 나가지 않습니다.';
  }
  return found.status === 'TSC03'
    ? '승인됨. 목록의 발송 스위치로 켜고 끕니다.'
    : '카카오 승인 전입니다. 승인 전에 켜면 알림톡이 나가지 않습니다.';
}

/** 자동 발송 기록의 우리 쪽 상태 — NHN 이 받았는지까지만 안다 */
export function autoSendStatusLabel(status: string): string {
  if (status === 'SENT') return '카카오 접수';
  if (status === 'FAILED') return '접수 실패';
  return '보내기 전';
}

/** 「결과 보기」로 NHN 에 물어본 수신 결과 */
export function autoSendOutcomeLabel(
  result: Pick<AlimtalkAutoSendResult, 'outcome' | 'detail'>
): string {
  const withDetail = (label: string) =>
    result.detail ? `${label} (${result.detail})` : label;
  switch (result.outcome) {
    case 'kakao':
      return '카카오톡으로 받음';
    case 'sms':
      return '문자로 대신 받음';
    case 'failed':
      return withDetail('못 받음');
    case 'NOT_ACCEPTED':
      return withDetail('접수되지 않음');
    default:
      return '처리 중';
  }
}
