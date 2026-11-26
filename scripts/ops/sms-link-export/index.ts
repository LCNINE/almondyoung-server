/**
 * 외부 문자 서비스(엑셀 업로드)로 보낼 수신자별 추적 링크와 업로드 엑셀을 만든다. 사용법은 README.md.
 *
 * 기본은 dry-run — 대상 수·길이만 보이고 DB·파일에 아무것도 쓰지 않는다. --apply 때만 notification DB 에
 * 캠페인 1행 + 링크 N행을 한 트랜잭션으로 넣고 엑셀을 쓴다. 엑셀은 트랜잭션 전에 임시 파일로 써 두고
 * 커밋이 성공해야 제 이름으로 바꾼다 — DB 와 파일 중 하나만 남지 않게.
 */
import { execFileSync } from 'child_process';
import { readFileSync, renameSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import {
  externalSmsCampaigns,
  smsOptOuts,
  smsTrackedLinks,
} from '../../../apps/notification/database/schemas/notification-schema';
import { profiles, userConsents, users } from '../../../apps/user-service/database/drizzle/schema';
import { assertAudienceLoaded, AudienceMember, classifyRecipients } from './recipients';
import { describeError } from './errors';
import { buildRows, ExportRow, LMS_MAX_BYTES, SMS_MAX_BYTES } from './messages';
import { readPhoneList, toDisplayPhone, writeUploadWorkbook } from './workbook';

const INSERT_CHUNK = 500;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function usage(message: string): never {
  console.error(message);
  console.error(
    '사용법: USER_DATABASE_URL=… NOTIFICATION_DATABASE_URL=… STOREFRONT_URL=… npx tsx scripts/ops/sms-link-export/index.ts ' +
      '--list=<번호 목록> --template=<문구 파일> --campaign=<이름> --provider=<발송 서비스> --tenant=<id> --created-by=<직원 id> --out=<xlsx> [--apply]',
  );
  process.exit(2);
}

/** 번호가 든 파일이 커밋되지 않게: 레포 밖이거나 git 이 무시하는 경로만 받는다. */
function assertUntracked(out: string): void {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();
  if (!out.startsWith(`${top}/`)) return;
  try {
    execFileSync('git', ['check-ignore', '-q', out], { cwd: top });
  } catch {
    usage('--out 이 레포 안의 추적되는 경로다. 레포 밖이나 git 이 무시하는 곳(.scratch 등)에 쓴다.');
  }
}

const maskPhone = (display: string) => display.replace(/-(\d{3,4})-/, (_, middle: string) => `-${'*'.repeat(middle.length)}-`);

function report(counts: object, rows: ExportRow[]): void {
  const sms = rows.filter((row) => row.bytes <= SMS_MAX_BYTES).length;
  const longest = rows.reduce((max, row) => Math.max(max, row.bytes), 0);
  console.log('갈래별 수:', counts);
  console.log(`SMS ${sms}건 · LMS ${rows.length - sms}건 · 가장 긴 행 ${longest}바이트(발송 서비스 고정 문구 포함)`);
  for (const row of rows.slice(0, 3)) {
    console.log(`--- ${maskPhone(toDisplayPhone(row.recipient.phone))} (${row.bytes}바이트)\n${row.body}`);
  }
}

async function main(): Promise<void> {
  const listPath = argValue('list');
  const templatePath = argValue('template');
  const campaign = argValue('campaign');
  const tenantId = argValue('tenant');
  const createdBy = argValue('created-by');
  const provider = argValue('provider');
  const outArg = argValue('out');
  const apply = process.argv.includes('--apply');
  const { USER_DATABASE_URL, NOTIFICATION_DATABASE_URL, STOREFRONT_URL } = process.env;
  if (!listPath || !templatePath || !campaign || !tenantId || !createdBy || !provider || !outArg) usage('인자가 빠졌다.');
  if (!USER_DATABASE_URL || !NOTIFICATION_DATABASE_URL || !STOREFRONT_URL) usage('환경변수가 빠졌다.');
  const out = resolve(outArg);
  if (!out.endsWith('.xlsx')) usage('--out 은 .xlsx 여야 한다.');
  assertUntracked(out);

  const userClient = postgres(USER_DATABASE_URL, { max: 1 });
  const notificationClient = postgres(NOTIFICATION_DATABASE_URL, { max: 1 });
  try {
    const userDb = drizzle(userClient);
    const notificationDb = drizzle(notificationClient);

    // 테넌트 안의 번호 있는 계정 전부 — 휴면·탈퇴도 읽어 그 번호를 «비회원»으로 보내지 않게 한다.
    // 보낼지·이름·회원 id 는 활성(UsersService.smsAudienceConditions 의 탈퇴·휴면 아님) 계정만으로 정한다.
    const memberRows = await userDb
      .select({
        userId: users.id,
        username: users.username,
        phoneNumber: profiles.phoneNumber,
        marketingConsent: userConsents.marketingConsent,
        active: sql<boolean>`(${users.deletedAt} is null and ${users.dormantAt} is null)`,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(userConsents, eq(userConsents.userId, users.id))
      .where(
        and(
          eq(users.tenantId, tenantId),
          isNotNull(profiles.phoneNumber),
          ne(profiles.phoneNumber, ''),
        ),
      );
    const members: AudienceMember[] = memberRows.map((row) => ({
      userId: row.userId,
      username: row.username,
      phoneNumber: row.phoneNumber ?? '',
      marketingConsent: row.marketingConsent ?? false,
      active: row.active,
    }));
    assertAudienceLoaded(members, tenantId);
    console.log(`테넌트 ${tenantId}: 번호 있는 계정 ${members.length}개(활성 ${members.filter((m) => m.active).length})`);
    const optedOut = new Set((await notificationDb.select({ phone: smsOptOuts.phone }).from(smsOptOuts)).map((r) => r.phone));

    const { recipients, counts } = classifyRecipients({ listPhones: await readPhoneList(listPath), members, optedOut });
    const rows = buildRows(readFileSync(templatePath, 'utf8').trim(), recipients, STOREFRONT_URL.replace(/\/$/, ''));
    report(counts, rows);

    if (rows.length === 0) {
      console.error('보낼 사람이 없다.');
      process.exitCode = 1;
      return;
    }
    const tooLong = rows.filter((row) => row.bytes > LMS_MAX_BYTES).length;
    if (tooLong > 0) {
      console.error(`${LMS_MAX_BYTES}바이트를 넘는 행이 ${tooLong}건 — 문구를 줄인다.`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log('dry-run — DB·파일에 아무것도 쓰지 않았다. 확인했으면 --apply 로 다시 돌린다.');
      return;
    }

    const [existing] = await notificationDb
      .select({ campaignId: externalSmsCampaigns.campaignId })
      .from(externalSmsCampaigns)
      .where(eq(externalSmsCampaigns.name, campaign));
    if (existing) {
      console.error(`같은 이름의 캠페인이 이미 있다(${existing.campaignId}). 다시 넣지 않는다.`);
      process.exitCode = 1;
      return;
    }

    const tmp = `${out}.tmp`;
    rmSync(tmp, { force: true });
    execFileSync('mkdir', ['-p', dirname(out)]);
    await writeUploadWorkbook(
      rows.map((row) => ({ phone: toDisplayPhone(row.recipient.phone), body: row.body })),
      tmp,
    );
    try {
      const campaignId = await notificationDb.transaction(async (tx) => {
        const [created] = await tx
          .insert(externalSmsCampaigns)
          .values({ name: campaign, provider, createdBy })
          .returning({ campaignId: externalSmsCampaigns.campaignId });
        const links = rows.flatMap((row) =>
          row.links.map((link) => ({
            code: link.code,
            url: link.url,
            campaignId: created.campaignId,
            recipientPhone: row.recipient.phone,
            recipientUserId: row.recipient.userId,
          })),
        );
        for (let i = 0; i < links.length; i += INSERT_CHUNK) {
          await tx.insert(smsTrackedLinks).values(links.slice(i, i + INSERT_CHUNK));
        }
        return created.campaignId;
      });
      renameSync(tmp, out);
      console.log(`넣었다: 캠페인 ${campaignId} · 수신자 ${rows.length}명 · 엑셀 ${out}`);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  } finally {
    await Promise.all([userClient.end(), notificationClient.end()]);
  }
}

main().catch((error: unknown) => {
  // 쿼리 오류 메시지에는 params(번호·회원 id)가 통째로 실린다 — 원인만 찍는다.
  console.error(describeError(error));
  process.exit(1);
});
