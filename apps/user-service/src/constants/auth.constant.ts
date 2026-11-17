import { INTERNAL_SESSION_TOKEN_AUDIENCE } from '@app/authorization';

// jsonwebtoken 의 expiresIn 은 '15m' 같은 리터럴 타입이라 env(string) 은 캐스팅이 필요하다.
const JWT_ACCESS_TOKEN_EXPIRATION = (process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '15m') as `${number}m`;
const JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION = '5m'; // 비밀번호 재설정 액세스 토큰 만료 시간
const JWT_REFRESH_TOKEN_EXPIRATION = '2w'; // 일반 로그인 (2주)
const JWT_REFRESH_TOKEN_LONG_EXPIRATION = '90d'; // 자동 로그인 (90일)
const JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION = '10m'; // 이메일 인증 액세스 토큰 만료 시간
const JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION = '5m'; // PIN 재설정용 verification 토큰 만료 시간
const JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION = '60s'; // 이메일 인증 직후 → auth-web /callback/signup 한 번 왕복용. 짧을수록 좋음.
const JWT_SOCIAL_CALLBACK_TOKEN_EXPIRATION = '60s'; // 소셜 콜백 → storefront /{provider}/callback 한 번 왕복용.

// 내부 access token의 audience. OAuth로 발급된 토큰(aud=client_id)과 구분하기 위함.
// 값은 공유 서비스 문과 한 곳에서 온다 — 문은 이 토큰을 «T 의 토큰»으로 본다(`served-tenant-gate.ts`).
const INTERNAL_TOKEN_AUDIENCE = INTERNAL_SESSION_TOKEN_AUDIENCE;

// signup callback 토큰의 purpose claim. 다른 verification JWT가 callbackSignup에 잘못 사용되는 것을 막는다.
const SIGNUP_CALLBACK_TOKEN_PURPOSE = 'signup_callback';

// social callback 토큰의 purpose claim. signup_callback / 다른 verification JWT 와의 교차 사용 차단.
const SOCIAL_CALLBACK_TOKEN_PURPOSE = 'social_callback';

// 결제창 핸드오프 코드를 받을 수 있는 유일한 클라이언트. 쇼핑몰이 이 클라이언트 몫의 인가 코드만 대신 받아 준다.
const PAYMENT_HANDOFF_CLIENT_ID = 'wallet-web';

export {
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION,
  JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION,
  JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION,
  JWT_SOCIAL_CALLBACK_TOKEN_EXPIRATION,
  INTERNAL_TOKEN_AUDIENCE,
  SIGNUP_CALLBACK_TOKEN_PURPOSE,
  SOCIAL_CALLBACK_TOKEN_PURPOSE,
  PAYMENT_HANDOFF_CLIENT_ID,
};
