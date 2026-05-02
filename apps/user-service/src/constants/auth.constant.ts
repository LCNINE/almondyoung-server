const JWT_ACCESS_TOKEN_EXPIRATION = '15m'; // 액세스 토큰 만료 시간
const JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION = '5m'; // 비밀번호 재설정 액세스 토큰 만료 시간
const JWT_REFRESH_TOKEN_EXPIRATION = '2w'; // 일반 로그인 (2주)
const JWT_REFRESH_TOKEN_LONG_EXPIRATION = '90d'; // 자동 로그인 (90일)
const JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION = '10m'; // 이메일 인증 액세스 토큰 만료 시간
const JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION = '5m'; // PIN 재설정용 verification 토큰 만료 시간
const JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION = '60s'; // 이메일 인증 직후 → auth-web /callback/signup 한 번 왕복용. 짧을수록 좋음.

// 내부 access token의 audience. OAuth로 발급된 토큰(aud=client_id)과 구분하기 위함.
const INTERNAL_TOKEN_AUDIENCE = 'user-service-internal';

// signup callback 토큰의 purpose claim. 다른 verification JWT가 callbackSignup에 잘못 사용되는 것을 막는다.
const SIGNUP_CALLBACK_TOKEN_PURPOSE = 'signup_callback';

export {
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_RESET_PASSWORD_ACCESS_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  JWT_EMAIL_VERIFICATION_ACCESS_TOKEN_EXPIRATION,
  JWT_PIN_RESET_VERIFICATION_TOKEN_EXPIRATION,
  JWT_SIGNUP_CALLBACK_TOKEN_EXPIRATION,
  INTERNAL_TOKEN_AUDIENCE,
  SIGNUP_CALLBACK_TOKEN_PURPOSE,
};
