import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuthorizationService, PermissionCheckpoints } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../platform/auth/inventory-scopes';

const NEW_SKU_DENIED = '새 재고상품을 만들려면 inventory.manage 권한이 필요합니다.';

/** payload 의 links 중 하나라도 새 재고상품 생성을 요구하는가. */
export function bodyRequestsNewSku(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const links = (body as { links?: unknown }).links;
  if (!Array.isArray(links)) return false;
  return links.some(
    (link) => !!link && typeof link === 'object' && (link as { newSku?: unknown }).newSku !== undefined,
  );
}

/**
 * 매칭 해소는 지금까지 AdminRealmGuard 만으로 지켜졌다. 거기에 「새 재고상품을 만든다」는
 * 능력이 얹히므로, 그 능력에만 `inventory.manage` 를 요구한다 —
 * `POST /inventory/skus` 가 요구하는 것과 같은 스코프다.
 *
 * 라우트 전체에 `@RequireScopes` 를 붙이지 않는 이유: (a) 지금 매칭만 하던 계정이 403 이 되고
 * (b) AdminRealmGuard 가 그 메타데이터를 보고 직원 역할 검사를 건너뛴다
 * (`admin-realm.guard.ts:47`). 단조 안전하지 않다.
 */
@Injectable()
export class NewSkuScopeGuard implements CanActivate {
  private readonly logger = new Logger(NewSkuScopeGuard.name);

  constructor(
    @Inject(AuthorizationService) private readonly authService: Pick<AuthorizationService, 'getScopesByRoles'>,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ body?: unknown; user?: { roles?: unknown } }>();

    if (!bodyRequestsNewSku(request.body)) {
      return true;
    }

    const roles = request.user?.roles;
    const roleNames = Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
    const legacy = await this.legacyAllows(Array.isArray(roles) && roles.length > 0, roleNames);
    if (this.checkpoints.compare('inventory.new_sku', legacy, { roles: roleNames }, ['inventory.master.write'])) {
      return true;
    }
    throw new ForbiddenException(NEW_SKU_DENIED);
  }

  /**
   * 옛 판정. 역할 조회 실패는 그림자 모드에선 지금처럼 바로 거부한다(비교하지 않는다). 새 판정이 결정하는
   * 모드에선 옛 판정을 «거부»로 넘기고 결과는 판정 지점이 정한다 — 옛 표 조회 실패가 새 판정을 막지 않게.
   */
  private async legacyAllows(hasRoles: boolean, roleNames: string[]): Promise<boolean> {
    if (!hasRoles) return false;
    if (roleNames.includes('master')) return true;
    let scopes: Set<string>;
    try {
      scopes = await this.authService.getScopesByRoles(roleNames);
    } catch (error) {
      this.logger.error('Failed to fetch role-scope mappings from DB', error);
      if (this.checkpoints.enforced) return false;
      throw new ForbiddenException(NEW_SKU_DENIED);
    }
    return scopes.has('master') || scopes.has(INVENTORY_SCOPE.MANAGE);
  }
}
