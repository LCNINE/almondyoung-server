import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isValidRedirectUri } from './redirect-uri';
import { IssueCodeRequestDto } from './dto/issue-code.dto';
import { CreateOAuthClientDto } from '../admin/oauth-clients/dto/oauth-clients.dto';

describe('isValidRedirectUri', () => {
  // 네이티브 앱은 커스텀 스킴으로 콜백을 받는다(RFC 8252 §7.1). class-validator 의 @IsUrl 은
  // validator.js 기본값(protocols: http/https/ftp)을 써서 이걸 거부했고, 그 결과 앱 로그인이
  // /oauth/issue-code 에서 400 으로 죽었다. loopback 을 쓰는 물류앱은 http 라 통과해서
  // 이 구멍이 오래 드러나지 않았다.
  it('accepts private-use scheme URIs used by native apps', () => {
    expect(isValidRedirectUri('almondyoung://oauth/callback')).toBe(true);
    expect(isValidRedirectUri('almondyoung://callback/oidc')).toBe(true);
    expect(isValidRedirectUri('com.example.app:/oauth2redirect')).toBe(true);
  });

  it('accepts the http(s) redirect URIs already in use', () => {
    expect(isValidRedirectUri('https://almondyoung.com/kr/callback/oidc')).toBe(true);
    expect(isValidRedirectUri('http://localhost:8001/kr/callback/oidc')).toBe(true);
    expect(isValidRedirectUri('http://127.0.0.1/callback')).toBe(true);
  });

  // redirect_uri 는 등록 화이트리스트와 exact match 로만 쓰이지만, 애초에 들어오지 못하게
  // 막는 편이 낫다 — 등록 API 가 관리자 실수로 위험한 스킴을 받아주면 안 된다.
  it('rejects script-bearing and non-network schemes', () => {
    expect(isValidRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isValidRedirectUri('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isValidRedirectUri('file:///etc/passwd')).toBe(false);
  });

  // RFC 6749 §3.1.2 — redirect endpoint URI MUST NOT include a fragment component.
  it('rejects URIs carrying a fragment', () => {
    expect(isValidRedirectUri('https://almondyoung.com/callback#frag')).toBe(false);
    expect(isValidRedirectUri('almondyoung://oauth/callback#frag')).toBe(false);
  });

  it('rejects values that are not absolute URIs', () => {
    expect(isValidRedirectUri('/kr/callback/oidc')).toBe(false);
    expect(isValidRedirectUri('almondyoung.com/callback')).toBe(false);
    expect(isValidRedirectUri('not a url')).toBe(false);
    expect(isValidRedirectUri('')).toBe(false);
    expect(isValidRedirectUri(undefined)).toBe(false);
  });
});

describe('DTO validation', () => {
  const baseIssueCode = {
    clientId: 'almondyoung-android-app',
    userId: '019d0004-0005-7000-a000-000000000005',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    codeChallengeMethod: 'S256' as const,
  };

  async function errorsFor(dto: object) {
    return (await validate(dto)).flatMap((e) => Object.keys(e.constraints ?? {}).map(() => e.property));
  }

  // 이 DTO 가 앱 로그인을 막고 있던 지점이다 (auth-web → user-service /oauth/issue-code).
  it('accepts a private-use scheme redirectUri on IssueCodeRequestDto', async () => {
    const dto = plainToInstance(IssueCodeRequestDto, {
      ...baseIssueCode,
      redirectUri: 'almondyoung://oauth/callback',
    });
    expect(await errorsFor(dto)).not.toContain('redirectUri');
  });

  it('still rejects a malformed redirectUri on IssueCodeRequestDto', async () => {
    const dto = plainToInstance(IssueCodeRequestDto, { ...baseIssueCode, redirectUri: 'not a url' });
    expect(await errorsFor(dto)).toContain('redirectUri');
  });

  it('accepts private-use scheme redirectUris when registering a client', async () => {
    const dto = plainToInstance(CreateOAuthClientDto, {
      clientId: 'almondyoung-android-app',
      clientType: 'public',
      redirectUris: ['almondyoung://oauth/callback'],
    });
    expect(await errorsFor(dto)).not.toContain('redirectUris');
  });

  it('still rejects a malformed redirectUri when registering a client', async () => {
    const dto = plainToInstance(CreateOAuthClientDto, {
      clientId: 'almondyoung-android-app',
      clientType: 'public',
      redirectUris: ['javascript:alert(1)'],
    });
    expect(await errorsFor(dto)).toContain('redirectUris');
  });
});
