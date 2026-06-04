#!/usr/bin/env tsx
/**
 * dev/test 전용 — CMS 회원 상태 강제 전환
 *
 * 환경 조건 (둘 다 필요):
 *   NODE_ENV !== 'production'
 *   ENABLE_DEV_CMS_HELPERS=true
 *
 * Usage:
 *   dotenv -e apps/wallet/.env -- \
 *     ENABLE_DEV_CMS_HELPERS=true \
 *     npx tsx apps/wallet/scripts/dev-cms-member-state.ts \
 *       --id <value> \
 *       --id-type cmsMemberId|id|billingMethodId \
 *       --member-status REGISTERED|FAILED|PENDING|DELETED \
 *       [--agreement-status 등록|실패|미등록] \
 *       [--result-code DEV_REGISTERED] \
 *       [--result-message "dev helper: testing"]
 *
 * Or via npm:
 *   npm run wallet:dev:cms-member -- --id ... --id-type ... --member-status ...
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { cmsMembers, cmsAgreements, billingMethods } from '../src/schema';

// ─── env guards ──────────────────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  console.error('[dev-cms-member-state] ERROR: 운영 환경에서는 실행 불가');
  process.exit(1);
}

if (process.env.ENABLE_DEV_CMS_HELPERS !== 'true') {
  console.error('[dev-cms-member-state] ERROR: ENABLE_DEV_CMS_HELPERS=true 환경변수 필요');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[dev-cms-member-state] ERROR: DATABASE_URL 환경변수 필요');
  process.exit(1);
}

// ─── arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

const id = args['id'];
const idType = (args['id-type'] as 'cmsMemberId' | 'id' | 'billingMethodId') ?? 'cmsMemberId';
const memberStatus = args['member-status'] as 'PENDING' | 'REGISTERED' | 'FAILED' | 'DELETED' | undefined;
const agreementStatus = args['agreement-status'] as '등록' | '실패' | '미등록' | undefined;
const resultCode = args['result-code'];
const resultMessage = args['result-message'];

if (!id) {
  console.error('[dev-cms-member-state] ERROR: --id 필요');
  console.error('Usage:');
  console.error('  --id <value>');
  console.error('  --id-type cmsMemberId|id|billingMethodId  (default: cmsMemberId)');
  console.error('  --member-status PENDING|REGISTERED|FAILED|DELETED');
  console.error('  --agreement-status 등록|실패|미등록  (optional)');
  console.error('  --result-code DEV_REGISTERED  (optional)');
  console.error('  --result-message "..."  (optional)');
  process.exit(1);
}

if (!memberStatus && !agreementStatus) {
  console.error('[dev-cms-member-state] ERROR: --member-status 또는 --agreement-status 중 하나 이상 필요');
  process.exit(1);
}

const validMemberStatuses = ['PENDING', 'REGISTERED', 'FAILED', 'DELETED'];
if (memberStatus && !validMemberStatuses.includes(memberStatus)) {
  console.error(`[dev-cms-member-state] ERROR: --member-status 는 ${validMemberStatuses.join('|')} 중 하나여야 함`);
  process.exit(1);
}

const validAgreementStatuses = ['등록', '실패', '미등록'];
if (agreementStatus && !validAgreementStatuses.includes(agreementStatus)) {
  console.error(`[dev-cms-member-state] ERROR: --agreement-status 는 ${validAgreementStatuses.join('|')} 중 하나여야 함`);
  process.exit(1);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = postgres(DATABASE_URL!, { max: 1 });
  const db = drizzle(client);

  try {
    // 1. cms_member 조회
    let member;
    if (idType === 'cmsMemberId') {
      const rows = await db.select().from(cmsMembers).where(eq(cmsMembers.cmsMemberId, id)).limit(1);
      member = rows[0];
    } else if (idType === 'id') {
      const rows = await db.select().from(cmsMembers).where(eq(cmsMembers.id, id)).limit(1);
      member = rows[0];
    } else if (idType === 'billingMethodId') {
      const rows = await db.select().from(cmsMembers).where(eq(cmsMembers.billingMethodId, id)).limit(1);
      member = rows[0];
    }

    if (!member) {
      console.error(`[dev-cms-member-state] ERROR: CMS member not found (id=${id}, idType=${idType})`);
      process.exit(1);
    }

    const beforeMember = { status: member.status, resultCode: member.resultCode, resultMessage: member.resultMessage };
    console.log(`[dev-cms-member-state] Found cms_member id=${member.id} cmsMemberId=${member.cmsMemberId}`);
    console.log(`  before: status=${beforeMember.status} resultCode=${beforeMember.resultCode ?? '-'}`);

    // 2. cms_member 상태 전환
    if (memberStatus) {
      const appliedResultCode = resultCode ?? `DEV_${memberStatus}`;
      const appliedResultMessage = resultMessage ?? `dev helper: marked ${memberStatus} for testing`;

      await db
        .update(cmsMembers)
        .set({
          status: memberStatus,
          resultCode: appliedResultCode,
          resultMessage: appliedResultMessage,
          updatedAt: new Date(),
        })
        .where(eq(cmsMembers.id, member.id));

      console.log(`  after: status=${memberStatus} resultCode=${appliedResultCode}`);
      console.log(`         resultMessage="${appliedResultMessage}"`);
    }

    // 3. cms_agreement 처리
    if (agreementStatus) {
      const existingAgreements = await db
        .select()
        .from(cmsAgreements)
        .where(eq(cmsAgreements.cmsMemberId, member.cmsMemberId));

      if (existingAgreements.length > 0) {
        // 최신 레코드 갱신
        const latest = existingAgreements.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        const agResultCode = resultCode ?? (agreementStatus === '등록' ? 'DEV_AGREEMENT_REGISTERED' : 'DEV_AGREEMENT_FAILED');
        const agResultMessage = resultMessage ?? `dev helper: agreement ${agreementStatus}`;

        await db
          .update(cmsAgreements)
          .set({
            status: agreementStatus,
            resultCode: agResultCode,
            resultMessage: agResultMessage,
            updatedAt: new Date(),
          })
          .where(eq(cmsAgreements.id, latest.id));

        console.log(`  agreement: updated id=${latest.id} status=${agreementStatus}`);
      } else if (agreementStatus !== '미등록') {
        // 레코드 없으면 생성 (미등록은 그냥 없는 상태로 둠)
        const agResultCode = resultCode ?? (agreementStatus === '등록' ? 'DEV_AGREEMENT_REGISTERED' : 'DEV_AGREEMENT_FAILED');
        const agResultMessage = resultMessage ?? `dev helper: agreement ${agreementStatus}`;

        const rows = await db
          .insert(cmsAgreements)
          .values({
            cmsMemberId: member.cmsMemberId,
            agreementKey: `dev-${member.cmsMemberId}-${Date.now()}`,
            fileType: '전자서명',
            fileExtension: 'png',
            status: agreementStatus,
            resultCode: agResultCode,
            resultMessage: agResultMessage,
          })
          .returning();
        console.log(`  agreement: created id=${rows[0].id} status=${agreementStatus}`);
      } else {
        console.log(`  agreement: no existing record, status '미등록' — nothing to do`);
      }
    }

    // 4. billing_method 상태 확인 (조회만, 수정하지 않음)
    const bmRows = await db
      .select({ id: billingMethods.id, status: billingMethods.status })
      .from(billingMethods)
      .where(eq(billingMethods.id, member.billingMethodId))
      .limit(1);
    const bm = bmRows[0];

    // 5. 최종 상태 계산
    const finalMemberStatus = memberStatus ?? member.status;
    const agreementRows = await db
      .select()
      .from(cmsAgreements)
      .where(eq(cmsAgreements.cmsMemberId, member.cmsMemberId));
    const latestAgreement = agreementRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const finalAgreementStatus = latestAgreement?.status ?? null;
    const isSelectable =
      bm?.status === 'ACTIVE' && finalMemberStatus === 'REGISTERED' && finalAgreementStatus === '등록';

    console.log('\n[dev-cms-member-state] 최종 상태:');
    console.log(`  cmsMemberId          : ${member.cmsMemberId}`);
    console.log(`  billingMethodId      : ${member.billingMethodId}`);
    console.log(`  cmsMemberStatus      : ${finalMemberStatus}`);
    console.log(`  agreementStatus      : ${finalAgreementStatus ?? '(없음)'}`);
    console.log(`  billingMethodStatus  : ${bm?.status ?? '(unknown)'}`);
    console.log(`  isSelectableForRecurringBilling: ${isSelectable}`);

    if (process.env.NODE_ENV !== 'test') {
      console.log('\n[dev-cms-member-state] 완료 — 테스트 시나리오 확인:');
      console.log('  storefront /mypage/membership/payment-method 를 새로고침하면 상태가 반영됩니다.');
      console.log('  admin 정기결제 관리 화면에서도 변경된 상태를 확인할 수 있습니다.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[dev-cms-member-state] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
