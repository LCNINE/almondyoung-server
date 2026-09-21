import Anthropic from '@anthropic-ai/sdk';
import { CronOnce } from '@app/cron-once';
import { DbService, InjectDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression } from '@nestjs/schedule';
import { USER_STREAM } from '@packages/event-contracts';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { businessLicenses, users, type UserServiceSchema } from '../../../database/drizzle/schema';
import { BusinessLicensesService, isCorporateBusinessNumber } from './business-licenses.service';
import {
  AutoReviewManualReason,
  AutoReviewRecord,
  BusinessMetadata,
  IsBusinessNumberChecksumConstraint,
  NtsValidateResult,
} from './dto/business-license.dto';
import { LICENSE_READER_MODEL, LicenseImageReader, LicenseReading } from './license-image-reader';

const BATCH_SIZE = 20;

const checksum = new IsBusinessNumberChecksumConstraint();

type Submission = { id: string; fileUrl: string };

// 판독하는 사이 관리자가 결정했거나(#820) 고객이 서류를 바꿔 다시 냈으면 쓰지 않는다.
const sameSubmission = ({ id, fileUrl }: Submission) =>
  and(eq(businessLicenses.id, id), eq(businessLicenses.status, 'under_review'), eq(businessLicenses.fileUrl, fileUrl));

type Verdict =
  | { decision: 'approve'; businessNumber: string; representativeName: string; verification: NtsValidateResult }
  | { decision: 'manual'; reason: AutoReviewManualReason; verification?: NtsValidateResult }
  | { decision: 'retry' };

export function judgeReading(
  reading: LicenseReading,
  accountName: string,
): { reason: AutoReviewManualReason } | { businessNumber: string; representativeName: string; startDate: string } {
  if (!reading.isBusinessRegistration) return { reason: 'not_license' };

  const { businessNumber, representativeName, startDate } = reading;
  if (!reading.readable || !businessNumber || !representativeName || !startDate) return { reason: 'unreadable' };
  if (!checksum.validate(businessNumber)) return { reason: 'unreadable' };

  if (reading.isCorporation || isCorporateBusinessNumber(businessNumber)) return { reason: 'corporation' };

  // 남의 등록증을 올린 건 국세청 진위확인으로는 안 걸리고 이 대조로만 걸린다.
  const normalize = (s: string) => s.replace(/\s/g, '');
  if (normalize(representativeName) !== normalize(accountName)) return { reason: 'name_mismatch' };

  return { businessNumber, representativeName, startDate };
}

// 서류 첨부 사업자 인증 자동 심사 (#930). 자동 반려는 없다 — 통과 못 하면 under_review 로 남는다.
@Injectable()
export class BusinessLicenseAutoReviewService {
  private readonly logger = new Logger(BusinessLicenseAutoReviewService.name);

  constructor(
    @InjectDb()
    private readonly dbService: DbService<UserServiceSchema>,
    private readonly configService: ConfigService,
    private readonly businessLicensesService: BusinessLicensesService,
    private readonly reader: LicenseImageReader,
    @InjectPublisher(USER_STREAM)
    private readonly eventPublisher: PublisherFor<typeof USER_STREAM>,
  ) {}

  @CronOnce(CronExpression.EVERY_10_MINUTES, { name: 'business-license-auto-review' })
  async reviewFileSubmissions(): Promise<void> {
    if (!this.reader.isConfigured()) return;
    const dryRun = this.configService.get<string>('BUSINESS_LICENSE_AUTO_APPROVE') !== 'true';

    const rows = await this.dbService.db
      .select({
        id: businessLicenses.id,
        userId: businessLicenses.userId,
        fileUrl: businessLicenses.fileUrl,
        metadata: businessLicenses.metadata,
        email: users.email,
        username: users.username,
      })
      .from(businessLicenses)
      .innerJoin(users, eq(users.id, businessLicenses.userId))
      .where(
        and(
          eq(businessLicenses.status, 'under_review'),
          isNotNull(businessLicenses.fileUrl),
          isNull(businessLicenses.deletedAt),
          // 자동 승인이 켜지면 dry-run 때 판정만 남긴 건도 다시 본다.
          dryRun
            ? sql`${businessLicenses.metadata}->'autoReview' is null`
            : sql`coalesce((${businessLicenses.metadata}->'autoReview'->>'dryRun')::boolean, true)`,
        ),
      )
      .orderBy(asc(businessLicenses.createdAt))
      .limit(BATCH_SIZE);

    for (const row of rows) {
      if (!row.fileUrl) continue;

      let reading: LicenseReading | undefined;
      let verdict: Verdict;
      try {
        reading = await this.reader.read(row.fileUrl);
        verdict = await this.judge(reading, row.username);
      } catch (error) {
        if (error instanceof Anthropic.BadRequestError) {
          verdict = { decision: 'manual', reason: 'image_unavailable' };
        } else {
          this.logger.warn(`사업자 자동심사: ${row.id} 판독 실패 — 다음 주기에 재시도 (${String(error)})`);
          continue;
        }
      }
      if (verdict.decision === 'retry') continue;

      // jsonb 라 unknown 으로 내려온다. 우리가 쓴 모양이다.
      const previous = (row.metadata as BusinessMetadata | null) ?? {};
      const record: AutoReviewRecord = {
        decision: verdict.decision,
        reason: verdict.decision === 'manual' ? verdict.reason : undefined,
        dryRun,
        model: LICENSE_READER_MODEL,
        reviewedAt: new Date().toISOString(),
        reading,
      };
      const metadata: BusinessMetadata = {
        ...previous,
        autoReview: record,
        ...(verdict.verification ? { ntsValidate: verdict.verification } : {}),
      };

      const submission = { id: row.id, fileUrl: row.fileUrl };
      if (verdict.decision === 'approve' && !dryRun) {
        await this.approve({ ...row, ...submission }, verdict, metadata);
      } else {
        await this.recordOnly(submission, metadata);
        this.logger.log(`사업자 자동심사: ${row.id} → ${verdict.decision}${dryRun ? ' (dry-run)' : ''}`);
      }
    }
  }

  private async judge(reading: LicenseReading, accountName: string): Promise<Verdict> {
    const judged = judgeReading(reading, accountName);
    if ('reason' in judged) return { decision: 'manual', reason: judged.reason };

    const { businessNumber, representativeName, startDate } = judged;
    const verification = await this.businessLicensesService.verifyWithNts(
      businessNumber,
      representativeName,
      startDate,
    );

    if (verification.status === 'lookup_failed') return { decision: 'retry' };
    if (!verification.valid) return { decision: 'manual', reason: 'nts_mismatch', verification };
    if (verification.status !== 'active') return { decision: 'manual', reason: 'not_active', verification };
    return { decision: 'approve', businessNumber, representativeName, verification };
  }

  private async approve(
    row: Submission & { userId: string; email: string; username: string },
    verdict: Extract<Verdict, { decision: 'approve' }>,
    metadata: BusinessMetadata,
  ): Promise<void> {
    let updated: { id: string } | undefined;
    try {
      [updated] = await this.dbService.db
        .update(businessLicenses)
        .set({
          status: 'approved',
          businessNumber: verdict.businessNumber,
          representativeName: verdict.representativeName,
          metadata,
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(sameSubmission(row))
        .returning({ id: businessLicenses.id });
    } catch (error) {
      // 23505: 같은 번호를 다른 계정이 이미 등록했다.
      if ((error as { cause?: { code?: string } })?.cause?.code !== '23505') throw error;
      const record = metadata.autoReview;
      if (!record) throw error;
      await this.recordOnly(row, {
        ...metadata,
        autoReview: { ...record, decision: 'manual', reason: 'duplicate_number' },
      });
      this.logger.log(`사업자 자동심사: ${row.id} → manual (duplicate_number)`);
      return;
    }

    if (!updated) {
      this.logger.log(`사업자 자동심사: ${row.id} 는 그 사이 다른 곳에서 결정됐다 — 건너뜀`);
      return;
    }

    this.logger.log(`사업자 자동심사: ${row.id} → approved`);
    await this.eventPublisher.publishEvent({
      eventType: 'BusinessLicenseApproved',
      aggregateId: row.userId,
      payload: { userId: row.userId, email: row.email, name: row.username },
    });
  }

  private async recordOnly(submission: Submission, metadata: BusinessMetadata): Promise<void> {
    await this.dbService.db
      .update(businessLicenses)
      .set({ metadata, updatedAt: new Date() })
      .where(sameSubmission(submission));
  }
}
