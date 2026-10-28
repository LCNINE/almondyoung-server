import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionCheckpoints } from '@app/authorization';

const NEW_SKU_DENIED = '새 재고상품을 만들려면 inventory.master.write 권한이 필요합니다.';

/** payload 의 links 중 하나라도 새 재고상품 생성을 요구하는가. */
export function bodyRequestsNewSku(body: unknown): boolean {
  if (!body || typeof body !== 'object' || !('links' in body)) return false;
  const links = body.links;
  if (!Array.isArray(links)) return false;
  return links.some(
    (link: unknown) => !!link && typeof link === 'object' && 'newSku' in link && link.newSku !== undefined,
  );
}

/**
 * 매칭 해소 라우트는 매칭 권한으로 열린다. 거기에 「새 재고상품을 만든다」는 능력이 얹히므로,
 * 본문이 그걸 요구할 때만 `inventory.master.write` 를 더 요구한다 — SKU 를 직접 만드는 라우트와 같은 권한이다.
 *
 * 라우트 전체에 그 권한을 걸지 않는 이유: 지금 매칭만 하던 계정이 새 SKU 없는 해소까지 403 이 된다.
 */
@Injectable()
export class NewSkuPermissionGuard implements CanActivate {
  constructor(private readonly checkpoints: PermissionCheckpoints) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ body?: unknown; user?: { roles?: unknown } }>();

    if (!bodyRequestsNewSku(request.body)) {
      return true;
    }

    const roles = request.user?.roles;
    const roleNames = Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
    if (this.checkpoints.check('inventory.new_sku', { roles: roleNames }, ['inventory.master.write'])) {
      return true;
    }
    throw new ForbiddenException(NEW_SKU_DENIED);
  }
}
