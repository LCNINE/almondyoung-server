import { userConsents } from 'apps/user-service/database/drizzle/schema';
import { InferSelectModel } from 'drizzle-orm';

export interface IConsent {
  isOver14: boolean;
  termsOfService: boolean;
  electronicTransaction: boolean;
  privacyPolicy: boolean;
  thirdPartySharing: boolean;
  marketingConsent: boolean; // 마케팅 수신 동의 (통합)
}

export type UserConsent = InferSelectModel<typeof userConsents>;
