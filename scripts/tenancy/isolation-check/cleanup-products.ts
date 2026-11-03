import { messageOf, tokenClaimsOf, type Probe } from './judge';

/** 그 테넌트의 전권 역할 — 점검 계정은 그 테넌트의 첫 master 로 만든다(`create-tenant/steps.ts` 첫 master 단계). */
const TENANT_MASTER_ROLE = 'master';

export interface CleanupPorts {
  /** 점검 계정(테넌트 2 의 첫 master)으로 로그인한 테넌트 2 토큰 */
  signInTenantTwo(): Promise<string>;
  deleteProduct(token: string, masterId: string): Promise<Probe>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 격리 실측(--write)이 만든 «[개통 점검]» 상품을 점검 계정의 토큰으로 지운다. 점검 계정은 그 테넌트의 master 라 삭제 권한이 있다 —
 * 운영자가 삭제 역할을 잠깐 주고 거두는 길은 없다(ADR-0056: 운영자가 다른 테넌트에 부여하지 않는다). 돌려주는 것은 못 지운 것의
 * 설명 — 진입점이 실행 끝에 그대로 출력한다.
 */
export async function removeProductsAsCheckMaster(
  ports: CleanupPorts,
  masterIds: readonly string[],
): Promise<string[]> {
  if (masterIds.length === 0) return [];
  const all = (why: string) => [`상품 ${masterIds.join(', ')} (${why})`];
  let token: string;
  try {
    token = await ports.signInTenantTwo();
  } catch (e) {
    return all(`점검 계정 로그인 실패: ${errorText(e)}`);
  }
  const roles = tokenClaimsOf(token).roles;
  if (!Array.isArray(roles) || !roles.includes(TENANT_MASTER_ROLE)) {
    return all(
      '점검 계정이 그 테넌트의 master 가 아니다 — `npm run tenant:create -- --stage <stage> --plan <계획>` 을 다시 돌려 점검 계정을 첫 master 로 세운 뒤 지운다',
    );
  }

  const left: string[] = [];
  for (const [i, id] of masterIds.entries()) {
    try {
      const r = await ports.deleteProduct(token, id);
      if (r.status < 200 || r.status >= 300) left.push(`상품 ${id} (${r.status} «${messageOf(r.body)}»)`);
    } catch (e) {
      // 던진 그 상품부터 뒤는 지워졌는지 모른다 — 남은 것으로 적는다
      left.push(`상품 ${masterIds.slice(i).join(', ')} (${errorText(e)})`);
      break;
    }
  }
  return left;
}
