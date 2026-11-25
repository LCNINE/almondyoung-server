import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError, Modules } from '@medusajs/framework/utils';

type Metadata = Record<string, unknown>;

// 고객이 누구인지(user-service 사용자)를 가리키는 키. 채널 어댑터가 주문 고객 id 로 쓰고 core·Medusa 가 그걸로 주인을 가린다.
// 고객이 바꾸면 다른 사용자로 행세하게 되므로 스토어 API 로는 쓸 수 없다
export const IDENTITY_METADATA_KEYS = ['almond_user_id', 'almond_login_id', 'withdrawn_at'] as const;

export const withoutIdentity = (metadata: Metadata): Metadata =>
  Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !(IDENTITY_METADATA_KEYS as readonly string[]).includes(key)),
  );

const pick = (source: Metadata, keys: Record<string, string>): Metadata =>
  Object.fromEntries(
    Object.entries(keys)
      .map(([target, from]) => [target, source[from]] as const)
      .filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );

// 가입: 신원 키는 본문이 아니라 로그인 신원(SSO 공급자가 검증해 넣은 user_metadata)에서만 채운다.
// 신원이 없으면 주인 없는 고객이 조용히 생기므로 거절한다
export function creationMetadata(incoming: Metadata | null | undefined, trustedUserMetadata: Metadata): Metadata {
  if (!trustedUserMetadata.user_id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, 'Login identity has no user id');
  }

  return {
    ...withoutIdentity(incoming ?? {}),
    ...pick(trustedUserMetadata, { almond_user_id: 'user_id', almond_login_id: 'login_id' }),
  };
}

// 수정: Medusa 는 metadata 객체를 기존 값에 합친다. 신원 키만 빼서 보내면 지금 값이 남는다.
// metadata: null 은 합치지 않고 통째로 지우므로 아예 보내지 않는다
export function updateMetadataPatch(incoming: Metadata | null | undefined): Metadata | undefined {
  return incoming ? withoutIdentity(incoming) : undefined;
}

type AuthContext = { auth_identity_id?: string; user_metadata?: Metadata };
type WithBody = {
  body?: { metadata?: Metadata | null };
  validatedBody?: { metadata?: Metadata | null };
  auth_context?: AuthContext;
};

// 토큰을 갱신하면 user_metadata 가 빠질 수 있어, 비어 있으면 인증 신원의 공급자 정보에서 다시 읽는다
async function trustedUserMetadata(req: MedusaRequest & WithBody): Promise<Metadata> {
  const fromToken = req.auth_context?.user_metadata ?? {};
  const authIdentityId = req.auth_context?.auth_identity_id;
  if (fromToken.user_id || !authIdentityId) {
    return fromToken;
  }

  const auth = req.scope.resolve(Modules.AUTH);
  const identity = await auth.retrieveAuthIdentity(authIdentityId, { relations: ['provider_identities'] });
  const withUserId = (identity.provider_identities ?? []).find((provider) => provider.user_metadata?.user_id);

  return (withUserId?.user_metadata as Metadata | undefined) ?? fromToken;
}

// POST /store/customers 는 Medusa 코어 라우트라 미들웨어로 고친다. 코어 검증 뒤에 돌고 핸들러는 validatedBody 를 쓴다
export async function customerCreationIdentityMiddleware(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const request = req as MedusaRequest & WithBody;
  try {
    const trusted = await trustedUserMetadata(request);
    // 지금은 검증 뒤라 validatedBody 만 쓰이지만, 순서가 바뀌어도 막히게 원본 본문도 고친다
    for (const body of [request.validatedBody, request.body]) {
      if (body && typeof body === 'object') {
        body.metadata = creationMetadata(body.metadata, trusted);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}
