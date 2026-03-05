import { BaseUserInfo } from './common';

// ===== 인증 관련 =====
interface SignupDto {
  isOver14: boolean;
  termsOfService: boolean;
  electronicTransaction: boolean;
  privacyPolicy: boolean;
  thirdPartySharing: boolean;
  marketingConsent: boolean;
  email: string;
  username: string;
  nickname: string;
  loginId: string;
  password: string;
}

interface SigninDto {
  loginId: string;
  password: string;
  rememberMe?: boolean;
}

interface ChangePasswordDto {
  password: string;
}

export type { SignupDto, SigninDto, ChangePasswordDto };
