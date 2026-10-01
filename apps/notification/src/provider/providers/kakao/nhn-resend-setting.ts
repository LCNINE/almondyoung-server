/**
 * 발신 프로필에 대체 발송(문자) 설정이 없을 때 NHN 이 요청 전체를 거절하며 돌려주는 문구.
 * 이 거절은 받는 사람 한 명도 접수되지 않은 상태라, 대체 발송을 빼고 다시 보내도 두 번 나가지 않는다.
 */
const RESEND_SETTING_MISSING = /resend setting/i;

export function isResendSettingMissing(message: string | undefined | null): boolean {
  return typeof message === 'string' && RESEND_SETTING_MISSING.test(message);
}
