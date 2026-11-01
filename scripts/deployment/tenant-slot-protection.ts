/**
 * 테넌트 도메인 칸을 받는 SST 사이트의 `protection` 판정. 왜 `none` 이어야 하는지는 spec 머리 주석.
 * `protection` 을 spread·`transform.cdn` 뒤에 숨기면 못 본다 — 사이트 인자에 직접 적는 것만 본다.
 * 칸을 받는 사이트는 손으로 적지 않고 `attachTenantDomainSlots('<이름>', …)` 호출에서 도출한다.
 */
export interface TenantSlotProtectionViolation {
  readonly path: string;
  readonly site: string;
  readonly rule: 'protection-not-none' | 'site-declaration-not-found';
  readonly detail: string;
}

interface SourceFile {
  readonly path: string;
  readonly content: string;
}

// `https://` 의 `//` 는 주석이 아니다 — 지우면 그 줄의 닫는 중괄호까지 사라져 블록 끝을 잘못 찾는다.
const stripLineComments = (s: string) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** `attachTenantDomainSlots('<이름>', …)` 로 칸을 받는 사이트 이름(주석 제외). */
export function tenantSlotSitesIn(content: string): string[] {
  return [...stripLineComments(content).matchAll(/attachTenantDomainSlots\(\s*['"](\w+)['"]/g)].map((m) => m[1]);
}

/** `new sst.aws.Nextjs('<name>', {` 다음의 인자 객체 본문. 중괄호 짝으로 끝을 찾는다. */
function nextjsArgsBlock(content: string, name: string): string | undefined {
  const start = new RegExp(`new\\s+sst\\.aws\\.Nextjs\\(\\s*['"]${name}['"]\\s*,\\s*\\{`).exec(content);
  if (!start) return undefined;
  let depth = 1;
  for (let i = start.index + start[0].length; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}' && --depth === 0) return content.slice(start.index + start[0].length, i);
  }
  return undefined;
}

export function findTenantSlotProtectionViolations(files: SourceFile[]): TenantSlotProtectionViolation[] {
  const code = files.map((f) => ({ path: f.path, content: stripLineComments(f.content) }));
  const violations: TenantSlotProtectionViolation[] = [];
  for (const f of code) {
    for (const site of tenantSlotSitesIn(f.content)) {
      const block = code.map((c) => nextjsArgsBlock(c.content, site)).find((b) => b !== undefined);
      if (block === undefined) {
        violations.push({
          path: f.path,
          site,
          rule: 'site-declaration-not-found',
          detail: `new sst.aws.Nextjs('${site}', { … }) 를 찾지 못했다`,
        });
        continue;
      }
      const protection = /\bprotection\s*:\s*([^,\n]+)/.exec(block);
      if (protection && !/^['"]none['"]$/.test(protection[1].trim())) {
        violations.push({ path: f.path, site, rule: 'protection-not-none', detail: protection[0].trim() });
      }
    }
  }
  return violations;
}
