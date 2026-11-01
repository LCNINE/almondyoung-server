import { join } from 'node:path';
import { parseTenantList, type TenantEntry } from '../../../../libs/tenancy/src/tenant-list';
import { tenantSlotSecretNames, type TenantSlotSite } from '../../../../deployments/lcnine/tenant-domain-slots';
import { foreignEntry, sameEntry, serializeTenantList } from '../tenant-list-env';

/**
 * 라이브 만들기의 사람 손 멈춤 지점. 출력(todo)은 «무엇을, 어느 Secret 에, 어떤 명령으로»뿐이고 값은 싣지 않는다 —
 * 값은 `files`(계획 파일 옆, 0600)에 쓰고 명령은 `sst secret load <파일>` 로 그 파일을 가리킨다.
 * 점검 계정 비밀번호는 여기를 지나지 않는다(스크립트가 stdin 으로 Secret 에 바로 넣는다).
 */
export interface PreparedStop {
  files: { path: string; content: string }[];
  todo: string[];
}

export interface SlotValues {
  domain: string;
  certArn: string;
  zoneId: string;
}

const APP_DIR: Record<TenantSlotSite, string> = {
  AdminWeb: 'deployments/lcnine/services',
  AuthWeb: 'deployments/lcnine/auth',
};

/** 셸에 그대로 붙여 넣을 인자 — 홑따옴표로 감싸고 안의 홑따옴표는 끊어 잇는다 */
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const load = (site: TenantSlotSite, file: string, stage: string) =>
  `cd ${APP_DIR[site]} && npx sst secret load ${shellQuote(file)} --stage ${stage} && rm ${shellQuote(file)}`;

export function prepareSlotSecrets(input: {
  stage: string;
  slot: number;
  admin: SlotValues;
  auth: SlotValues;
  dir: string;
}): PreparedStop {
  const { stage, slot } = input;
  const sites: [TenantSlotSite, SlotValues, string][] = [
    ['AdminWeb', input.admin, join(input.dir, `tenant-slot-${slot}.services.secrets.env`)],
    ['AuthWeb', input.auth, join(input.dir, `tenant-slot-${slot}.auth.secrets.env`)],
  ];
  const files = sites.map(([site, v, path]) => {
    const names = tenantSlotSecretNames(site, slot);
    return {
      path,
      content: `${names.domain}=${v.domain}\n${names.certArn}=${v.certArn}\n${names.zoneId}=${v.zoneId}\n`,
    };
  });
  return {
    files,
    todo: [
      `① 테넌트 도메인 칸 ${slot} 의 Secret 셋씩을 두 앱에 넣는다(값은 아래 파일에 있다 — 화면에 띄우지 말 것):`,
      ...sites.map(([site, , path]) => {
        const n = tenantSlotSecretNames(site, slot);
        return `   ${site} (${n.domain}·${n.certArn}·${n.zoneId}): ${load(site, path, stage)}`;
      }),
      `   🔴 deployments/lcnine/tenant-domain-slots.ts 의 TENANT_DOMAIN_SLOTS 에 ${slot} 을 더하는 커밋(②)은 아직이다 — ` +
        '② 가 이 Secret 보다 먼저 develop 에 들어가면 그 뒤 모든 live 배포가 run() 맨 앞에서 멈춘다',
      '   넣은 뒤 이 스크립트를 다시 돌린다. 그다음 순서(지금 하지 말 것 — 뒤 멈춤들이 하나씩 안내한다):',
      `   ② TENANT_DOMAIN_SLOTS 에 ${slot} 을 더하는 커밋 (그 사이 목록 Secret TenantList 멈춤이 한 번 있다)`,
      `   ③ 배포 한 번 (auth → services) + 18 의 칸 켠 첫 배포 실측`,
    ],
  };
}

/** 목록 Secret(lcnine-auth `TenantList`) = 지금 목록 + 이 테넌트. 같은 id 가 다른 값이면 덮지 않는다. */
export function prepareTenantListSecret(input: {
  stage: string;
  current: string;
  entry: TenantEntry;
  dir: string;
}): PreparedStop {
  const entries = [...parseTenantList(input.current).entries];
  const existing = entries.find((e) => e.id === input.entry.id);
  if (existing && !sameEntry(existing, input.entry)) throw foreignEntry(input.entry.id);
  const next = existing ? entries : [...entries, input.entry];
  const path = join(input.dir, `tenant-list.auth.secrets.env`);
  return {
    files: [{ path, content: `TenantList=${serializeTenantList(next)}\n` }],
    todo: [
      `목록에 넣기 — lcnine-auth 의 Secret TenantList 를 «지금 목록 + 테넌트 ${input.entry.id}» 로 바꾼다(값은 파일에):`,
      `   ${load('AuthWeb', path, input.stage)}`,
      '   이 Secret 이 들어가면 되돌리기는 없다(목록 뒤는 퇴출). 넣은 뒤 이 스크립트를 다시 돌린다 — 다음 멈춤이 배포다',
    ],
  };
}

const rerun = (stage: string, planPath: string | undefined) =>
  `npm run tenant:create -- --stage ${stage} --plan ${planPath ?? '<계획 파일>'}`;

/** 18 의 칸 켜기 ②(표 커밋)·③(배포)와 칸 켠 첫 배포 실측(18 Answer). 4·6·7 은 다시 돌리면 «만든 직후 확인»이 잰다. */
export function deployTodo(input: { stage: string; slot: number; tableHasSlot: boolean; planPath?: string }): string[] {
  const { stage, slot } = input;
  const diffChecks = (site: TenantSlotSite) =>
    `      ${site}TenantSlot${slot}·${site}TenantSlot${slot}Record Created, pulumi:providers:command Created ` +
    `(…Invalidation 은 diff 에 안 보이는 게 정상). ${site}Cdn 아래 Distribution·CloudfrontFunctionRequest·ServerCachePolicy 줄이 ` +
    '있으면 멈춘다 — 칸은 아몬드영 사이트를 읽기만 해야 한다';
  return [
    input.tableHasSlot
      ? `② TENANT_DOMAIN_SLOTS 에 ${slot} 은 이미 있다 — 그 커밋이 develop 에 있는지만 본다`
      : `② deployments/lcnine/tenant-domain-slots.ts 의 TENANT_DOMAIN_SLOTS 에 \`${stage}: [${slot}]\`(이미 칸이 있으면 그 배열에 ${slot}) 을 더해 develop 에 커밋한다 — ① 의 Secret 이 다 들어간 뒤에만`,
    `③ 배포 한 번 (auth → services 순서 — services 가 배포 때 auth 의 SSM 목록을 읽는다):`,
    `   a. npm run deploy:preflight -- --stage ${stage}   (나온 마이그 순서대로 migrate 하고, 준 배포 명령의 환경변수를 같은 셸에서 쓴다)`,
    `   b. 배포 전 sst diff (18 실측 1·2):`,
    `      cd deployments/lcnine/auth && npx sst diff --stage ${stage}`,
    diffChecks('AuthWeb'),
    `      cd deployments/lcnine/services && npx sst diff --stage ${stage}`,
    diffChecks('AdminWeb'),
    `   c. cd deployments/lcnine/auth && npx sst deploy --stage ${stage}`,
    `   d. cd deployments/lcnine/services && npx sst deploy --stage ${stage}`,
    `      18 실측 3: 출력에서 AdminWeb 의 KvKeys·자산 업로드·Invalidation 뒤에 AdminWebTenantSlot${slot}Invalidation Created (auth 도 같은 꼴)`,
    `   e. npm run deploy:preflight -- --stage ${stage} --mark-deployed`,
    `   f. ${rerun(stage, input.planPath)} — 만든 직후 확인이 18 실측 4·6·7(무효화·BUILD_ID·인증서 SAN)을 잰다`,
    '   18 실측 5(변경 없는 재배포에선 무효화가 안 는다)는 다음 admin-web 배포에서 본다',
  ];
}

export function suspendTodo(input: { stage: string; planPath: string }): string {
  return `${rerun(input.stage, input.planPath)} --suspend`;
}
