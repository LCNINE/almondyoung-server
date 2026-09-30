import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { UserContact, UserContactClient } from '@app/shared';
import { eq } from 'drizzle-orm';
import type { MembershipArrearsSkippedReason } from '@packages/event-contracts/streams/membership.stream';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { DrizzleTransaction } from '../../shared/schemas/types';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';

export const BILLING_NOTICE_QUEUED_EVENT_TYPE = 'BILLING_NOTICE_QUEUED';
export const BILLING_NOTICE_SKIPPED_EVENT_TYPE = 'BILLING_NOTICE_SKIPPED';

/** 은행 사유 원문은 길이 제한이 없다 — 알림 한 줄에 들어갈 만큼만 싣는다. */
const REASON_TEXT_MAX = 40;

export type NoticeContact =
  | { ok: true; contact: UserContact & { phoneNumber: string } }
  | { ok: false; reason: 'CONTACT_LOOKUP_FAILED' | 'NO_CONTACT' | 'NO_PHONE' };

export interface BilledPeriodForNotice {
  periodStart?: string | null;
  periodEnd?: string | null;
  amount?: number | null;
}

export type ArrearsOutcome = { recordedAmount: number } | { skippedReason: MembershipArrearsSkippedReason };

/**
 * 정기결제 출금 실패·미납 해지를 고객에게 알리는 이벤트를 조립해 아웃박스에 싣는다.
 *
 * 연락처 조회는 트랜잭션 «밖»에서 한다 — user-service 가 느리거나 죽어도 결제 결과 처리(연체 표시·해지)는
 * 막히지 않아야 한다. 못 찾으면 알림만 건너뛰고 그 사실을 계약 이벤트로 남긴다.
 */
@Injectable()
export class BillingNoticeManager {
  private readonly logger = new Logger(BillingNoticeManager.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly userContactClient: UserContactClient,
    private readonly membershipEventPublisher: MembershipEventPublisher,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  /** 계약 주인의 연락처. 계약이 없으면 null(핸들러도 곧 같은 이유로 아무 일도 안 한다). */
  async lookupContactForContract(contractId: string): Promise<NoticeContact | null> {
    const [row] = await this.dbService.db
      .select({ userId: schema.subscriptionContracts.userId })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);
    if (!row) return null;
    return this.lookupContact(row.userId);
  }

  private async lookupContact(userId: string): Promise<NoticeContact> {
    let contact: UserContact | undefined;
    try {
      contact = (await this.userContactClient.findContacts([userId])).get(userId);
    } catch (error) {
      this.logger.warn(
        `[billing-notice] 연락처 조회 실패 — 알림 건너뜀 (userId=${userId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'CONTACT_LOOKUP_FAILED' };
    }
    if (!contact) return { ok: false, reason: 'NO_CONTACT' };
    if (!contact.phoneNumber) return { ok: false, reason: 'NO_PHONE' };
    return { ok: true, contact: { ...contact, phoneNumber: contact.phoneNumber } };
  }

  /** 재시도가 남은 출금 실패 한 건. 실패 마커가 새로 들어간 트랜잭션 안에서만 부른다. */
  async queueAttemptFailed(
    tx: DrizzleTransaction,
    input: {
      contact: NoticeContact;
      contractId: string;
      userId: string;
      invoiceId: string;
      markerKey: string;
      attemptCount: number;
      maxAttempts: number;
      nextAttemptAt: string;
      errorMessage: string | null;
      billed?: BilledPeriodForNotice;
    },
  ): Promise<void> {
    const remainingAttempts = input.maxAttempts - input.attemptCount;
    if (input.attemptCount < 1 || remainingAttempts < 1) {
      // 마지막 시도의 실패는 해지 안내가 대신한다.
      return;
    }
    if (!input.contact.ok) {
      await this.recordSkipped(tx, input.contractId, input.userId, 'ATTEMPT_FAILED', input.contact.reason);
      return;
    }
    const { contact } = input.contact;

    await this.membershipEventPublisher.saveBillingAttemptFailed(
      {
        userId: input.userId,
        userName: contact.username,
        phoneNumber: contact.phoneNumber,
        contractId: input.contractId,
        invoiceId: input.invoiceId,
        ...this.billedFields(input.billed),
        ...(input.billed?.amount != null && { amount: input.billed.amount }),
        attemptCount: input.attemptCount,
        maxAttempts: input.maxAttempts,
        remainingAttempts,
        nextAttemptRequestAt: input.nextAttemptAt,
        reasonText: this.shortReason(input.errorMessage),
        occurredAt: new Date().toISOString(),
      },
      tx,
      `membership:billing-failed:${input.markerKey}`,
    );
    await this.recordQueued(tx, input.contractId, input.userId, 'ATTEMPT_FAILED', { attemptNo: input.attemptCount });
  }

  /** 재시도 소진으로 해지된 한 건. 회수·미수 기록과 같은 트랜잭션 끝에서 부른다. */
  async queueTerminatedForNonPayment(
    tx: DrizzleTransaction,
    input: {
      contact: NoticeContact;
      contractId: string;
      userId: string;
      invoiceId: string;
      billed?: BilledPeriodForNotice;
      arrears: ArrearsOutcome;
    },
  ): Promise<void> {
    if (!input.contact.ok) {
      await this.recordSkipped(tx, input.contractId, input.userId, 'TERMINATED', input.contact.reason);
      return;
    }
    const { contact } = input.contact;
    const recorded = 'recordedAmount' in input.arrears;
    const arrearsAmount = 'recordedAmount' in input.arrears ? input.arrears.recordedAmount : null;
    const arrearsSkippedReason = 'skippedReason' in input.arrears ? input.arrears.skippedReason : null;

    await this.membershipEventPublisher.saveTerminatedForNonPayment(
      {
        userId: input.userId,
        userName: contact.username,
        phoneNumber: contact.phoneNumber,
        contractId: input.contractId,
        invoiceId: input.invoiceId,
        ...this.billedFields(input.billed),
        arrearsAmount,
        arrearsSkippedReason,
        occurredAt: new Date().toISOString(),
      },
      tx,
      `membership:terminated-notice:${input.contractId}`,
    );
    await this.recordQueued(tx, input.contractId, input.userId, 'TERMINATED', { withArrears: recorded });
  }

  private billedFields(billed?: BilledPeriodForNotice): { periodStart?: string; periodEnd?: string } {
    return {
      ...(billed?.periodStart && { periodStart: billed.periodStart }),
      ...(billed?.periodEnd && { periodEnd: billed.periodEnd }),
    };
  }

  private shortReason(errorMessage: string | null): string | null {
    const text = errorMessage?.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > REASON_TEXT_MAX ? `${text.slice(0, REASON_TEXT_MAX - 1)}…` : text;
  }

  private async recordQueued(
    tx: DrizzleTransaction,
    contractId: string,
    userId: string,
    kind: 'ATTEMPT_FAILED' | 'TERMINATED',
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.contractEventManager.addEvent(
      tx,
      contractId,
      BILLING_NOTICE_QUEUED_EVENT_TYPE,
      { kind, channel: 'KAKAO', ...extra },
      'SYSTEM',
      userId,
    );
  }

  private async recordSkipped(
    tx: DrizzleTransaction,
    contractId: string,
    userId: string,
    kind: 'ATTEMPT_FAILED' | 'TERMINATED',
    reason: string,
  ): Promise<void> {
    this.logger.warn(`[billing-notice] 알림 건너뜀 — ${reason} (contractId=${contractId}, kind=${kind})`);
    await this.contractEventManager.addEvent(
      tx,
      contractId,
      BILLING_NOTICE_SKIPPED_EVENT_TYPE,
      { kind, reason },
      'SYSTEM',
      userId,
    );
  }
}
