import { z } from 'zod';

/**
 * 라이브 실측이 읽는 값. 비밀은 전부 SST Secret 에서만 온다(env·파일로 받지 않는다 — 셸 이력·디스크에 남는다).
 *
 * `IsolationCheck`(lcnine-services 앱의 Secret) — 점검 계정. 만들기 스크립트(라이브)가 테넌트 2 점검 계정을 넣고,
 * 테넌트 1 점검 계정·고객 계정은 사람이 넣는다. 인프라에 선언하지 않는다 — 어떤 앱도 링크하지 않으므로, 선언하면
 * 값이 비었을 때 배포만 멈춘다. `sst secret set` 은 선언 없이도 값을 둔다.
 */
export const ISOLATION_CHECK_SECRET = 'IsolationCheck';

const account = { loginId: z.string().min(1), password: z.string().min(1) };
const isolationCheckSecretSchema = z.object({
  tenantOne: z.object(account),
  tenantTwo: z.object({ ...account, id: z.string().min(1), adminRedirectUri: z.string().url() }),
  customer: z.object({ ...account, redirectUri: z.string().url() }),
  /** 화면 실측 «흔적 0» 의 금지어 — 비공개 값이라 레포에 두지 않는다. 비면 그 항목이 언제나 초록이 되므로 거절한다 */
  forbiddenWords: z.array(z.string().min(1)).min(1),
});
export type IsolationCheckSecret = z.infer<typeof isolationCheckSecretSchema>;

const SET_HINT =
  `npx sst secret set ${ISOLATION_CHECK_SECRET} '<JSON>' --stage <stage> (deployments/lcnine/services 에서). ` +
  '모양: {"tenantOne":{loginId,password},"tenantTwo":{id,loginId,password,adminRedirectUri},"customer":{loginId,password,redirectUri},"forbiddenWords":["…"]}';

export function parseIsolationCheckSecret(raw: string): IsolationCheckSecret {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${ISOLATION_CHECK_SECRET} 가 JSON 이 아니다 → ${SET_HINT}`);
  }
  const parsed = isolationCheckSecretSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(전체)').join(', ');
    throw new Error(`${ISOLATION_CHECK_SECRET} 에 빠지거나 틀린 칸: ${where} → ${SET_HINT}`);
  }
  return parsed.data;
}

/** `sst secret list` 의 `Name=value` 줄. 그 밖의 줄(머리글 등)은 무시한다. */
export function parseSecretList(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line.trim());
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** 서비스 공개 주소 — `deployments/lcnine/services/infra/shared.ts` 의 `domain()` 과 같은 규칙. */
export function stageServiceUrl(stage: string, slug: string): string {
  return stage === 'live' ? `https://${slug}.almondyoung.com` : `https://${slug}.dev.lcnine-dev.com`;
}
