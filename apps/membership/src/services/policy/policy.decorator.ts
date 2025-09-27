import { SetMetadata } from '@nestjs/common';

export const POLICY_ACTION_KEY = 'policy_action';

/**
 * 컨트롤러 메소드에 적용하여 필요한 정책 검증 액션을 지정하는 데코레이터입니다.
 * @param action - PolicyService에서 검증할 액션 문자열 (예: 'PAUSE_SUBSCRIPTION')
 */
export const CheckPolicies = (action: string) =>
  SetMetadata(POLICY_ACTION_KEY, action);
