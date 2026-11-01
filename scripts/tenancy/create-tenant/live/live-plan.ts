import { z } from 'zod';
import { parseTenantList, TENANT_ID_PATTERN, TENANT_SLUG_PATTERN } from '../../../../libs/tenancy/src/tenant-list';
import type { TenantPlan } from '../steps';
import { TENANT_STAFF_ROLE } from '../tenant-staff-role';

/**
 * 라이브 계획 파일. 🔴 테넌트 값(slug·이름·도메인·명단)은 이 파일에만 있다 — 공개 레포에 두지 않는다
 * (`live.ts` 가 git 이 추적하거나 무시하지 않는 경로를 거절한다).
 *
 * `publicBucket`·`privateBucket`·`slot` 은 스크립트가 처음 한 번 정해 이 파일에 적는다(`fillGenerated`).
 */

/** 버킷·slug·도메인에 들어가면 안 되는 글자 — 공개 버킷 이름과 테넌트 도메인은 그 테넌트 고객에게 보인다. */
export const FORBIDDEN_WORDS = ['almond', 'lcnine'] as const;

export function forbiddenWordsIn(value: string): string[] {
  const lower = value.toLowerCase();
  return FORBIDDEN_WORDS.filter((w) => lower.includes(w));
}

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const S3_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const host = z.string().regex(HOST, '소문자 호스트 이름(스킴·포트·경로 없이)');

const livePlanSchema = z.object({
  id: z.string().regex(TENANT_ID_PATTERN),
  slug: z.string().regex(TENANT_SLUG_PATTERN),
  displayName: z.string().min(1),
  adminDomain: host,
  authDomain: host,
  checkAccount: z.object({ loginId: z.string().min(1), email: z.string().email() }),
  staff: z
    .array(z.object({ loginId: z.string().min(1), username: z.string().min(1), email: z.string().email() }))
    .default([]),
  publicBucket: z.string().regex(S3_BUCKET).optional(),
  privateBucket: z.string().regex(S3_BUCKET).optional(),
  slot: z.number().int().positive().optional(),
});
export type LivePlan = z.infer<typeof livePlanSchema>;

export function parseLivePlan(json: unknown): LivePlan {
  const parsed = livePlanSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.join('.') || '(전체)'}: ${i.message}`).join(', ');
    throw new Error(`계획 파일의 틀린 칸 — ${where}`);
  }
  const plan = parsed.data;
  const problems: string[] = [];
  for (const [field, value] of [
    ['slug', plan.slug],
    ['adminDomain', plan.adminDomain],
    ['authDomain', plan.authDomain],
    ['publicBucket', plan.publicBucket],
    ['privateBucket', plan.privateBucket],
  ] as const) {
    if (value === undefined) continue;
    const words = forbiddenWordsIn(value);
    if (words.length > 0) problems.push(`${field} 에 금지어 ${words.join('·')}`);
  }
  if (plan.adminDomain === plan.authDomain)
    problems.push('adminDomain 과 authDomain 은 달라야 한다(CloudFront 배포가 앱마다 하나)');
  if ((plan.publicBucket === undefined) !== (plan.privateBucket === undefined)) {
    problems.push('publicBucket·privateBucket 은 함께 있거나 함께 없어야 한다');
  }
  if (plan.publicBucket && plan.publicBucket === plan.privateBucket) problems.push('공개·비공개 버킷은 달라야 한다');
  if (problems.length > 0) throw new Error(`계획 파일 거절 — ${problems.join(' / ')}`);
  return plan;
}

/** 버킷 이름·칸 번호를 처음 한 번 정한다. 이미 있으면 그대로 — 다시 돌릴 때 같은 이름이어야 한다. */
export function fillGenerated(
  plan: LivePlan,
  gen: { randomTail: () => string; slot: number },
): { plan: LivePlan; changed: boolean } {
  let next = plan;
  if (!plan.publicBucket || !plan.privateBucket) {
    const tail = gen.randomTail();
    next = { ...next, publicBucket: `${plan.slug}-public-${tail}`, privateBucket: `${plan.slug}-private-${tail}` };
  }
  if (plan.slot === undefined) next = { ...next, slot: gen.slot };
  return { plan: parseLivePlan(next), changed: next !== plan };
}

/**
 * 테넌트 도메인 칸 번호. 이 테넌트 admin 도메인이 이미 든 칸(지난 실행이 Secret 을 넣었다)이 있으면 그 칸,
 * 없으면 표(`TENANT_DOMAIN_SLOTS`)에도 Secret 에도 안 쓰인 가장 작은 번호.
 */
export function pickSlot(input: {
  table: readonly number[];
  slotDomains: ReadonlyMap<number, string>;
  host: string;
}): number {
  for (const [slot, domain] of input.slotDomains) if (domain === input.host) return slot;
  const used = new Set([...input.table, ...input.slotDomains.keys()]);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export type FilledLivePlan = LivePlan & { publicBucket: string; privateBucket: string; slot: number };

export function isFilled(plan: LivePlan): plan is FilledLivePlan {
  return !!plan.publicBucket && !!plan.privateBucket && plan.slot !== undefined;
}

export function toTenantPlan(plan: FilledLivePlan): TenantPlan {
  const entry = {
    id: plan.id,
    slug: plan.slug,
    coreDb: `core_${plan.slug}`,
    publicBucket: plan.publicBucket,
    privateBucket: plan.privateBucket,
  };
  // 앱과 같은 파서로 본다 — 테넌트 1 과 함께 목록에 들어갈 값이다.
  parseTenantList(JSON.stringify([entry]));
  return {
    entry,
    displayName: plan.displayName,
    domains: [
      { host: plan.adminDomain, app: 'admin-web' },
      { host: plan.authDomain, app: 'auth-web' },
    ],
    staffClient: {
      clientId: 'admin-web',
      redirectUris: [`https://${plan.adminDomain}/auth/callback`],
      postLogoutRedirectUris: [`https://${plan.adminDomain}/login`],
    },
    role: { ...TENANT_STAFF_ROLE, permissions: [...TENANT_STAFF_ROLE.permissions] },
    checkAccount: {
      loginId: plan.checkAccount.loginId,
      username: '점검계정',
      nickname: '점검계정',
      email: plan.checkAccount.email,
    },
    staff: plan.staff,
  };
}
