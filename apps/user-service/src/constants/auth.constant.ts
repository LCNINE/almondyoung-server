const JWT_ACCESS_TOKEN_EXPIRATION = '15m'; // 액세스 토큰 만료 시간
const JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION = '5m'; // 비밀번호 재설정 액세스 토큰 만료 시간
const JWT_REFRESH_TOKEN_EXPIRATION = '2w'; // 일반 로그인 (2주)
const JWT_REFRESH_TOKEN_LONG_EXPIRATION = '90d'; // 자동 로그인 (90일)
const JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION = '10m'; // 이메일 인증 액세스 토큰 만료 시간
const JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION = '5m'; // PIN 재설정용 verification 토큰 만료 시간
const JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION = '60s'; // 이메일 인증 직후 → auth-web /callback/signup 한 번 왕복용. 짧을수록 좋음.
const JWT_SOCIAL_CALLBACK_TOKEN_EXPIRATION = '60s'; // 소셜 콜백 → storefront /{provider}/callback 한 번 왕복용.
const JWT_PAYMENT_HANDOFF_TOKEN_EXPIRATION = '120s'; // 결제창(wallet-web) 핸드오프 → storefront 가 발급, wallet-web 이 한 번 교환.

// 내부 access token의 audience. OAuth로 발급된 토큰(aud=client_id)과 구분하기 위함.
const INTERNAL_TOKEN_AUDIENCE = 'user-service-internal';

// signup callback 토큰의 purpose claim. 다른 verification JWT가 callbackSignup에 잘못 사용되는 것을 막는다.
const SIGNUP_CALLBACK_TOKEN_PURPOSE = 'signup_callback';

// social callback 토큰의 purpose claim. signup_callback / 다른 verification JWT 와의 교차 사용 차단.
const SOCIAL_CALLBACK_TOKEN_PURPOSE = 'social_callback';

// payment handoff 토큰의 purpose claim. 다른 verification JWT 가 핸드오프 교환에 잘못 쓰이는 것을 막는다.
const PAYMENT_HANDOFF_TOKEN_PURPOSE = 'payment_handoff';

export {
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION,
  JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION,
  JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION,
  JWT_SOCIAL_CALLBACK_TOKEN_EXPIRATION,
  JWT_PAYMENT_HANDOFF_TOKEN_EXPIRATION,
  INTERNAL_TOKEN_AUDIENCE,
  SIGNUP_CALLBACK_TOKEN_PURPOSE,
  SOCIAL_CALLBACK_TOKEN_PURPOSE,
  PAYMENT_HANDOFF_TOKEN_PURPOSE,
};
