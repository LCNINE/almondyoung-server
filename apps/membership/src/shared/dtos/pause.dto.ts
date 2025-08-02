/**
 * @deprecated 이 파일은 더 이상 사용되지 않습니다.
 * 대신 다음을 사용하세요:
 * - Controller 검증: ../schemas/requests.ts의 PauseSubscriptionRequestSchema
 * - Service 입력: ../schemas/types.ts의 PauseSubscriptionInput, ResumeSubscriptionInput
 * - 타입 정의: ../schemas/types.ts
 *
 * 이 파일은 하위 호환성을 위해 유지되며, 향후 제거될 예정입니다.
 */

// Re-export from centralized schemas
export {
  PauseSubscriptionRequestSchema as PauseRequestSchema,
  type PauseSubscriptionRequest as PauseRequestDto,
} from '../schemas/requests';

export { type ResumeSubscriptionInput as ResumeRequestDto } from '../schemas/types';
