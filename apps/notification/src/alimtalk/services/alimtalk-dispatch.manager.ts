import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '../../../database/schemas/notification-schema';
import { getContactForChannel } from '../../shared/utils/contact.utils';
import { Channel } from '../../shared/enums';
import { ALIMTALK_BATCH_SIZE, ALIMTALK_STALE_PROCESSING_MS } from '../alimtalk.constants';
import { NhnAlimtalkClient, NhnRequestRejectedError } from '../clients/nhn-alimtalk.client';
import { AlimtalkRepository } from '../repositories/alimtalk.repository';

const UNKNOWN_OUTCOME = '발송 요청 결과를 받지 못했습니다. 실제로 나갔을 수 있어 다시 보내지 않았습니다';

@Injectable()
export class AlimtalkDispatchManager {
  private readonly logger = new Logger(AlimtalkDispatchManager.name);

  constructor(
    private readonly repository: AlimtalkRepository,
    private readonly client: NhnAlimtalkClient,
  ) {}

  /** 한 주기에 한 묶음(최대 1,000명)을 NHN 한 요청으로 보낸다. */
  async dispatchDue(now: Date): Promise<void> {
    const stale = await this.repository.failStaleProcessing(
      new Date(now.getTime() - ALIMTALK_STALE_PROCESSING_MS),
      UNKNOWN_OUTCOME,
    );
    if (stale > 0) this.logger.warn(`알림톡 대량 발송: 결과를 모르는 채 멈춘 ${stale}건을 실패로 닫았습니다`);

    const campaignId = await this.repository.findNextDueCampaignId(now);
    if (!campaignId) return;
    const rows = await this.repository.claimBatch(campaignId, now, ALIMTALK_BATCH_SIZE);
    if (rows.length === 0) return;
    await this.send(campaignId, rows);
  }

  private async send(campaignId: string, rows: Notification[]): Promise<void> {
    const templateCode = String(rows[0].metadata?.templateCode ?? '');
    const sendable: { row: Notification; phone: string }[] = [];
    const noPhone: string[] = [];
    for (const row of rows) {
      const stored: unknown = row.payload?.phoneNumber;
      const phoneNumber = typeof stored === 'string' ? stored : undefined;
      const phone = getContactForChannel({ userId: row.userId, phoneNumber }, Channel.KAKAO);
      if (phone) sendable.push({ row, phone });
      else noPhone.push(row.notificationId);
    }
    await this.repository.markFailed(noPhone, '수신 번호가 없습니다 (운영 외 환경은 NOTIFICATION_DEV_PHONE 필요)');
    if (sendable.length === 0) return;

    try {
      const result = await this.client.sendTemplateBatch({
        templateCode,
        senderGroupingKey: campaignId,
        recipients: sendable.map(({ row, phone }) => ({
          recipientNo: phone,
          templateParameter: toStringRecord(row.metadata?.templateParameters),
          recipientGroupingKey: row.notificationId,
        })),
      });
      const accepted = new Set(result.results.filter((r) => r.resultCode === 0).map((r) => r.recipientGroupingKey));
      await this.repository.markSent([...accepted], result.requestId);
      const rejected = result.results.filter((r) => r.resultCode !== 0);
      for (const [message, ids] of groupBy(rejected)) {
        await this.repository.markFailed(ids, message || 'NHN 이 이 번호의 발송을 받지 않았습니다');
      }
      // 응답에 결과가 빠진 행은 접수됐는지 알 수 없다.
      const answered = new Set(result.results.map((r) => r.recipientGroupingKey));
      await this.repository.markFailed(
        sendable.map(({ row }) => row.notificationId).filter((id) => !answered.has(id)),
        UNKNOWN_OUTCOME,
      );
      this.logger.log(`알림톡 대량 발송 campaign=${campaignId} 접수 ${accepted.size} / 거절 ${rejected.length}`);
    } catch (error) {
      const ids = sendable.map(({ row }) => row.notificationId);
      if (error instanceof NhnRequestRejectedError) {
        // 템플릿 미승인·발신 프로필 문제 같은 요청 단위 거절이라 남은 묶음도 같은 이유로 거절된다.
        const reason = `NHN 이 발송 요청을 거절했습니다: ${error.message}`;
        await this.repository.markFailed(ids, reason);
        const rest = await this.repository.failPending(campaignId, reason);
        this.logger.error(`알림톡 대량 발송 거절 campaign=${campaignId}: ${error.message} (남은 ${rest}건도 중단)`);
        return;
      }
      await this.repository.markFailed(ids, UNKNOWN_OUTCOME);
      this.logger.error(
        `알림톡 대량 발송 응답 없음 campaign=${campaignId} ${ids.length}건: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v ?? '')]));
}

function groupBy(results: { recipientGroupingKey: string; resultMessage: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of results) map.set(r.resultMessage, [...(map.get(r.resultMessage) ?? []), r.recipientGroupingKey]);
  return map;
}
