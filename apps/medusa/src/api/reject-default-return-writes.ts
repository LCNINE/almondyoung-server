import type { MedusaNextFunction, MedusaRequest, MedusaResponse, MiddlewareRoute } from '@medusajs/framework/http';

export const DEFAULT_RETURN_ROUTE_BLOCKED_CODE = 'default_return_route_blocked';

export const DEFAULT_RETURN_WRITE_PREFIXES = [
  '/store/returns',
  '/admin/returns',
  '/admin/exchanges',
  '/admin/claims',
  '/admin/return-reasons',
] as const;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Medusa 기본 반품·교환·클레임·반품 사유 쓰기 라우트를 막는다(K8 설계 §4.2).
 * - `POST /store/returns` 는 인증·주문 소유 확인이 없고 반품비(`return_shipping`)를 클라이언트가 정한다 — 로그인 없이 남의 주문을 반품할 수 있다.
 * - 관리자 쓰기 라우트로 반품을 받으면 우리 정산(잠금·환불 종류·택배비 규칙)을 우회한다.
 * - 반품 사유의 metadata.feeBearer 는 택배비를 누가 내는지 정하는 돈 규칙이라 코드가 정본이다(PR2 N3·N4).
 * 반품은 우리 라우트가 워크플로를 직접 부르므로 이 미들웨어를 지나지 않는다. 읽기는 지난다.
 */
export function rejectDefaultReturnWrites(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  if (READ_METHODS.has(req.method)) return next();
  res.status(400).json({
    type: 'not_allowed',
    code: DEFAULT_RETURN_ROUTE_BLOCKED_CODE,
    message: '반품·교환은 이 경로로 처리할 수 없습니다. 쇼핑몰·admin-web 의 반품 화면을 쓰세요.',
  });
}

// method 를 주지 않는다 — 주면 express 경로 정확 일치(app.post)로 등록돼 `/admin/returns/*` 가 `/admin/returns` 자체를 놓친다.
// 없으면 app.use 로 세그먼트 경계 앞부분 일치라, 업그레이드가 이 아래에 새 쓰기 라우트를 더해도 같이 막힌다.
export const defaultReturnWriteMiddlewares: MiddlewareRoute[] = DEFAULT_RETURN_WRITE_PREFIXES.map((matcher) => ({
  matcher,
  middlewares: [rejectDefaultReturnWrites],
}));
