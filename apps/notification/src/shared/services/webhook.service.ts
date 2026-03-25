// apps/notification/src/shared/services/webhook.service.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and, sql } from 'drizzle-orm';
import { receipts, notificationLogs, notifications, templates } from '../../../database/schemas/notification-schema';
import { ResendWebhookData, ResendWebhookEvent } from '../../provider/providers/email/resend-webhook.dto';
import { AlertService } from './alert.service';
import { NotificationStatus } from '../enums';
import { StructuredLogger } from '../utils/logger.utils';

@Injectable()
export class WebhookService {
  private readonly logger: StructuredLogger;
  private readonly resendWebhook: Webhook;

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    private readonly configService: ConfigService,
    private readonly alertService: AlertService,
  ) {
    this.logger = new StructuredLogger(new Logger(WebhookService.name));

    // Resend webhook verifier 초기화
    const resendSecret = this.configService.get<string>('RESEND_WEBHOOK_SECRET');
    if (!resendSecret) {
      throw new Error('RESEND_WEBHOOK_SECRET 환경변수가 설정되어 있지 않습니다.');
    }
    this.resendWebhook = new Webhook(resendSecret);
  }

  private get db() {
    return this.dbService.db;
  }

  /**
   * Resend 웹훅 검증 및 처리
   */
  async handleResendWebhook(
    payload: string | ResendWebhookEvent,
    headers: {
      'svix-id': string;
      'svix-timestamp': string;
      'svix-signature': string;
    },
  ): Promise<void> {
    try {
      // 1. 서명 검증
      let event: ResendWebhookEvent;

      if (typeof payload === 'string') {
        // Raw body로 검증
        event = this.resendWebhook.verify(payload, headers) as ResendWebhookEvent;
      } else {
        // 이미 파싱된 경우 (개발 환경)
        if (process.env.NODE_ENV === 'production') {
          // 프로덕션에서는 반드시 raw body로 검증
          throw new UnauthorizedException('Invalid webhook payload format');
        }
        event = payload;
      }

      this.logger.log('Resend webhook received', {
        type: event.type,
        emailId: event.data.email_id,
        to: event.data.to,
      });

      // 2. 이벤트 타입별 처리
      await this.processResendEvent(event);
    } catch (error: any) {
      this.logger.error(
        'Failed to process Resend webhook',
        {
          error: error.message,
        },
        error.stack,
      );

      // 서명 검증 실패는 재시도하지 않음
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      // 다른 에러는 재시도를 위해 500 에러 반환
      throw new Error(`Webhook processing failed: ${error.message}`);
    }
  }

  private async processResendEvent(event: ResendWebhookEvent): Promise<void> {
    const { type, data } = event;
    const emailId = data.email_id;
    const tags = data.tags || {};

    // 태그에서 메타데이터 추출
    const notificationId = tags.notification_id;
    const userId = tags.user_id;
    const campaignId = tags.campaign_id;

    switch (type) {
      case 'email.sent':
        await this.handleEmailSent(emailId, notificationId, data);
        break;

      case 'email.delivered':
        await this.handleEmailDelivered(emailId, notificationId, data);
        break;

      case 'email.bounced':
        await this.handleEmailBounced(emailId, userId, data);
        break;

      case 'email.complained':
        await this.handleEmailComplained(emailId, userId, data);
        break;

      case 'email.opened':
        await this.handleEmailOpened(emailId, campaignId, data);
        break;

      case 'email.clicked':
        await this.handleEmailClicked(emailId, campaignId, data);
        break;

      case 'email.failed':
        await this.handleEmailFailed(emailId, notificationId, data);
        break;

      case 'email.delivery_delayed':
        await this.handleEmailDelayed(emailId, notificationId, data);
        break;

      default:
        this.logger.warn('Unknown webhook event type', { type });
    }

    // Receipt 저장 (감사 로그)
    await this.saveReceipt(event);
  }

  private async handleEmailSent(
    emailId: string,
    notificationId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    if (notificationId) {
      await this.db
        .update(notifications)
        .set({
          status: NotificationStatus.SENT,
          sentAt: new Date(data.created_at),
          updatedAt: new Date(),
        })
        .where(eq(notifications.notificationId, notificationId));
    }

    this.logger.log('Email sent', { emailId, notificationId });
  }

  private async handleEmailDelivered(
    emailId: string,
    notificationId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    if (notificationId) {
      await this.db
        .update(notifications)
        .set({
          status: NotificationStatus.DELIVERED,
          updatedAt: new Date(),
        })
        .where(eq(notifications.notificationId, notificationId));
    }

    this.logger.log('Email delivered', { emailId, notificationId });
  }

  private async handleEmailBounced(
    emailId: string,
    userId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    const bounceInfo = data.bounce;
    // 타입 안전성: to가 배열이고 비어있지 않은지 확인
    const recipientEmail =
      Array.isArray(data.to) && data.to.length > 0 ? data.to[0] : typeof data.to === 'string' ? data.to : 'unknown';

    this.logger.warn('Email bounced', {
      emailId,
      recipientEmail,
      bounceType: bounceInfo?.type,
      bounceMessage: bounceInfo?.message,
    });

    // Permanent bounce인 경우 운영 알림 생성
    if (bounceInfo?.type === 'Permanent') {
      await this.alertService.createAlert({
        type: 'email_permanent_bounce',
        severity: 'medium',
        title: 'Permanent email bounce detected',
        message: `Email ${recipientEmail} has been marked as invalid due to permanent bounce`,
        context: {
          userId: userId,
          email: recipientEmail,
          bounceMessage: bounceInfo.message,
        },
      });
    }
  }

  private async handleEmailComplained(
    emailId: string,
    userId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    // 타입 안전성: to가 배열이고 비어있지 않은지 확인
    const recipientEmail =
      Array.isArray(data.to) && data.to.length > 0 ? data.to[0] : typeof data.to === 'string' ? data.to : 'unknown';

    this.logger.warn('Email complaint received', {
      emailId,
      recipientEmail,
    });

    // 운영 알림 생성
    await this.alertService.createAlert({
      type: 'spam_complaint',
      severity: 'high',
      title: 'Spam complaint received',
      message: `User marked email as spam: ${recipientEmail}`,
      context: {
        userId: userId,
        email: recipientEmail,
        emailId,
      },
    });
  }

  private async handleEmailOpened(
    emailId: string,
    campaignId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    // 캠페인 통계 업데이트
    if (campaignId) {
      await this.updateCampaignStats(campaignId, 'opened');
    }

    this.logger.log('Email opened', { emailId, campaignId });
  }

  private async handleEmailClicked(
    emailId: string,
    campaignId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    const clickInfo = data.click;

    // 캠페인 통계 업데이트
    if (campaignId) {
      await this.updateCampaignStats(campaignId, 'clicked');
    }

    this.logger.log('Email link clicked', {
      emailId,
      campaignId,
      link: clickInfo?.link,
      timestamp: clickInfo?.timestamp,
    });
  }

  private async handleEmailFailed(
    emailId: string,
    notificationId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    if (notificationId) {
      await this.db
        .update(notifications)
        .set({
          status: NotificationStatus.FAILED,
          errorDetails: {
            message: 'Email failed to send',
            timestamp: new Date(),
          },
          updatedAt: new Date(),
        })
        .where(eq(notifications.notificationId, notificationId));
    }

    this.logger.error('Email failed', {
      emailId,
      notificationId,
      to: data.to,
    });
  }

  private async handleEmailDelayed(
    emailId: string,
    notificationId: string | undefined,
    data: ResendWebhookData,
  ): Promise<void> {
    this.logger.warn('Email delivery delayed', {
      emailId,
      notificationId,
      to: data.to,
    });

    // 지연된 이메일은 특별한 처리 없이 로그만 남김
    // Resend가 자동으로 재시도함
  }

  private async updateCampaignStats(campaignId: string, statType: 'opened' | 'clicked'): Promise<void> {
    await this.db.execute(sql`
            UPDATE notification_campaigns
            SET 
                stats = jsonb_set(
                    stats,
                    '{${statType}}',
                    (COALESCE((stats->>'${statType}')::int, 0) + 1)::text::jsonb
                ),
                updated_at = NOW()
            WHERE campaign_id = ${campaignId}
        `);
  }

  private async saveReceipt(event: ResendWebhookEvent): Promise<void> {
    const tags = event.data.tags || {};

    // 타입 안전성을 위해 필요한 필드만 추출
    const providerResponse = {
      type: event.type,
      data: {
        email_id: event.data.email_id,
        to: event.data.to,
        from: event.data.from,
        subject: event.data.subject,
        created_at: event.data.created_at,
      },
      created_at: event.created_at,
    };

    await this.db.insert(receipts).values({
      notificationId: tags.notification_id || null,
      campaignId: tags.campaign_id || null,
      provider: 'resend',
      status: event.type,
      providerResponse: providerResponse as Record<string, any>,
      latencyMs: null,
      metadata: {
        emailId: event.data.email_id,
        to: event.data.to,
        from: event.data.from,
        subject: event.data.subject,
      },
      timestamp: new Date(event.created_at),
    });
  }

  /**
   * Twilio 웹훅 검증 및 처리
   *
   * Twilio Status Callback 웹훅을 처리합니다.
   * https://www.twilio.com/docs/messaging/api/message-resource#status-callback
   *
   * 참고: Twilio 웹훅 시그니처 검증은 X-Twilio-Signature 헤더를 사용합니다.
   * 현재는 기본 검증만 수행하며, 프로덕션 환경에서는 추가 검증 로직 구현 권장.
   */
  async handleTwilioWebhook(data: any, signature?: string, requestUrl?: string): Promise<void> {
    try {
      // 프로덕션 환경에서 시그니처 검증 (선택적)
      if (process.env.NODE_ENV === 'production' && signature && requestUrl) {
        // TODO: Twilio 시그니처 검증 구현
        // const twilioAuthToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
        // if (twilioAuthToken && !this.verifyTwilioSignature(data, signature, requestUrl, twilioAuthToken)) {
        //     throw new UnauthorizedException('Invalid Twilio webhook signature');
        // }
        this.logger.warn('Twilio webhook signature verification not implemented', {
          messageSid: data.MessageSid,
        });
      }

      this.logger.log('Twilio webhook received', {
        messageSid: data.MessageSid,
        messageStatus: data.MessageStatus,
        to: data.To,
      });

      // Twilio Status Callback 파라미터
      const messageSid = data.MessageSid;
      const messageStatus = data.MessageStatus;
      const to = data.To;
      const errorCode = data.ErrorCode;
      const errorMessage = data.ErrorMessage;

      if (!messageSid) {
        this.logger.warn('Twilio webhook missing MessageSid', { data });
        return;
      }

      // messageSid로 notification 찾기 (metadata에 저장되어 있을 것으로 예상)
      const notification = await this.db.query.notifications.findFirst({
        where: and(eq(notifications.channel, 'SMS'), sql`metadata->>'messageSid' = ${messageSid}`),
      });

      // 또는 providerResponse에 messageSid가 있을 수 있음
      // 더 정확한 검색을 위해 receipts 테이블도 확인
      if (!notification) {
        const receipt = await this.db.query.receipts.findFirst({
          where: and(eq(receipts.provider, 'twilio'), sql`provider_response->>'sid' = ${messageSid}`),
        });

        if (receipt?.notificationId) {
          const found = await this.db.query.notifications.findFirst({
            where: eq(notifications.notificationId, receipt.notificationId),
          });
          if (found) {
            await this.processTwilioStatusUpdate(found, messageStatus, errorCode, errorMessage);
            return;
          }
        }
      } else {
        await this.processTwilioStatusUpdate(notification, messageStatus, errorCode, errorMessage);
      }

      // Receipt 저장
      await this.saveTwilioReceipt({
        messageSid,
        messageStatus,
        to,
        errorCode,
        errorMessage,
        ...data,
      });
    } catch (error: any) {
      this.logger.error(
        'Failed to process Twilio webhook',
        {
          error: error.message,
          data,
        },
        error.stack,
      );
      throw error;
    }
  }

  private async processTwilioStatusUpdate(
    notification: any,
    messageStatus: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    // Twilio 상태를 NotificationStatus로 매핑
    let status: NotificationStatus;
    switch (messageStatus) {
      case 'queued':
      case 'sending':
        status = NotificationStatus.PROCESSING;
        break;
      case 'sent':
        status = NotificationStatus.SENT;
        break;
      case 'delivered':
        status = NotificationStatus.DELIVERED;
        break;
      case 'undelivered':
      case 'failed':
        status = NotificationStatus.FAILED;
        break;
      default:
        this.logger.warn('Unknown Twilio message status', { messageStatus });
        return;
    }

    await this.db
      .update(notifications)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === NotificationStatus.FAILED && {
          errorDetails: {
            message: errorCode
              ? `[${errorCode}] ${errorMessage || `Twilio status: ${messageStatus}`}`
              : errorMessage || `Twilio status: ${messageStatus}`,
            timestamp: new Date(),
          },
        }),
      })
      .where(eq(notifications.notificationId, notification.notificationId));

    this.logger.log('Twilio notification status updated', {
      notificationId: notification.notificationId,
      status,
      messageStatus,
    });
  }

  private async saveTwilioReceipt(data: any): Promise<void> {
    await this.db.insert(receipts).values({
      provider: 'twilio',
      status: data.messageStatus || data.MessageStatus,
      providerResponse: data as Record<string, any>,
      metadata: {
        messageSid: data.messageSid || data.MessageSid,
        to: data.to || data.To,
        from: data.from || data.From,
      },
      timestamp: new Date(),
    });
  }

  /**
   * NHN KakaoTalk 웹훅 검증 및 처리
   *
   * NHN KakaoTalk API v2.3 웹훅 스펙 기반
   * https://docs.nhncloud.com/ko/Notification/KakaoTalk/ko/api-guide-v2.3/
   */
  async handleKakaoWebhook(payload: string | any, signature?: string): Promise<void> {
    try {
      // 1. 서명 검증 (프로덕션 환경)
      if (process.env.NODE_ENV === 'production') {
        const expectedSignature = this.configService.get<string>('NHN_WEBHOOK_SIGNATURE');

        if (!expectedSignature) {
          this.logger.warn('NHN_WEBHOOK_SIGNATURE is not configured in production');
        }

        if (!signature) {
          throw new UnauthorizedException('Missing Kakao webhook signature');
        }

        if (expectedSignature && signature !== expectedSignature) {
          throw new UnauthorizedException('Invalid Kakao webhook signature');
        }
      }

      // 2. 페이로드 파싱
      let webhookData: any;
      if (typeof payload === 'string') {
        webhookData = JSON.parse(payload);
      } else {
        webhookData = payload;
      }

      this.logger.log('Kakao webhook received', {
        event: webhookData.event,
        hooksId: webhookData.hooksId,
        appKey: webhookData.appKey,
      });

      // 3. 이벤트 타입별 처리
      if (webhookData.event === 'MESSAGE_RESULT_UPDATE') {
        await this.processKakaoMessageResultUpdate(webhookData);
      } else if (webhookData.event === 'TEMPLATE_STATUS_UPDATE') {
        await this.processKakaoTemplateStatusUpdate(webhookData);
      } else {
        this.logger.warn('Unknown Kakao webhook event type', {
          event: webhookData.event,
        });
      }
    } catch (error: any) {
      this.logger.error(
        'Failed to process Kakao webhook',
        {
          error: error.message,
        },
        error.stack,
      );

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new Error(`Kakao webhook processing failed: ${error.message}`);
    }
  }

  /**
   * Kakao 메시지 발송 결과 업데이트 처리
   */
  private async processKakaoMessageResultUpdate(webhookData: any): Promise<void> {
    const hooks = webhookData.hooks || [];

    for (const hook of hooks) {
      const { requestId, recipientSeq, resultCode, receiveDate, recipientNo } = hook;

      if (!requestId) {
        this.logger.warn('Kakao webhook missing requestId', { hook });
        continue;
      }

      // requestId로 notification 찾기
      // metadata에 requestId가 저장되어 있을 것으로 예상
      const notification = await this.db.query.notifications.findFirst({
        where: and(
          eq(notifications.channel, 'KAKAO'),
          // metadata에 requestId가 있는지 확인
          sql`metadata->>'requestId' = ${requestId}`,
        ),
      });

      // 또는 providerResponse에 requestId가 있을 수 있음
      if (!notification) {
        const receipt = await this.db.query.receipts.findFirst({
          where: and(eq(receipts.provider, 'nhn-kakao'), sql`provider_response->>'requestId' = ${requestId}`),
        });

        if (receipt?.notificationId) {
          const found = await this.db.query.notifications.findFirst({
            where: eq(notifications.notificationId, receipt.notificationId),
          });
          if (found) {
            await this.updateKakaoNotificationStatus(found, hook);
            continue;
          }
        }
      } else {
        await this.updateKakaoNotificationStatus(notification, hook);
      }

      // Receipt 저장
      await this.saveKakaoReceipt(hook, webhookData);
    }
  }

  /**
   * Kakao 알림 상태 업데이트
   */
  private async updateKakaoNotificationStatus(notification: any, hook: any): Promise<void> {
    const { resultCode, receiveDate, messageStatus } = hook;

    // NHN KakaoTalk resultCode를 NotificationStatus로 매핑
    // MRC01: 성공, MRC02: 실패
    let status: NotificationStatus;
    if (resultCode === 'MRC01') {
      status = NotificationStatus.DELIVERED;
    } else if (resultCode === 'MRC02') {
      status = NotificationStatus.FAILED;
    } else if (messageStatus === 'COMPLETED') {
      status = NotificationStatus.DELIVERED;
    } else if (messageStatus === 'FAILED') {
      status = NotificationStatus.FAILED;
    } else if (messageStatus === 'CANCEL') {
      status = NotificationStatus.CANCELLED;
    } else {
      // 알 수 없는 상태는 로그만 남기고 업데이트하지 않음
      this.logger.warn('Unknown Kakao result code', {
        resultCode,
        messageStatus,
        notificationId: notification.notificationId,
      });
      return;
    }

    await this.db
      .update(notifications)
      .set({
        status,
        updatedAt: new Date(),
        ...(receiveDate && {
          sentAt: new Date(receiveDate),
        }),
        ...(status === NotificationStatus.FAILED && {
          errorDetails: {
            message: resultCode
              ? `[${resultCode}] ${hook.resultCodeName || 'Kakao message delivery failed'}`
              : hook.resultCodeName || 'Kakao message delivery failed',
            timestamp: new Date(),
          },
        }),
      })
      .where(eq(notifications.notificationId, notification.notificationId));

    this.logger.log('Kakao notification status updated', {
      notificationId: notification.notificationId,
      requestId: hook.requestId,
      status,
      resultCode,
    });
  }

  /**
   * Kakao 템플릿 상태 업데이트 처리
   */
  private async processKakaoTemplateStatusUpdate(webhookData: any): Promise<void> {
    const hooks = webhookData.hooks || [];

    for (const hook of hooks) {
      const { templateCode, status, kakaoTemplateCode, comments, updateDate } = hook;

      if (!templateCode) {
        this.logger.warn('Kakao webhook missing templateCode', { hook });
        continue;
      }

      // 템플릿 상태 매핑
      // TSC01: 요청, TSC02: 검수 중, TSC03: 승인, TSC04: 반려
      const statusMap: Record<string, 'PENDING' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'INACTIVE'> = {
        TSC01: 'REQUESTED',
        TSC02: 'REQUESTED',
        TSC03: 'APPROVED',
        TSC04: 'REJECTED',
      };

      const templateStatus = statusMap[status] || 'PENDING';

      // templates 테이블에서 해당 템플릿 찾기
      const template = await this.db.query.templates.findFirst({
        where: eq(templates.kakaoTemplateCode, templateCode),
      });

      if (template) {
        await this.db
          .update(templates)
          .set({
            kakaoTemplateStatus: templateStatus as any,
            providerTemplateId: kakaoTemplateCode,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
            metadata: {
              ...(template.metadata || {}),
              lastWebhookUpdate: updateDate,
              comments: comments || [],
            },
          })
          .where(eq(templates.templateId, template.templateId));

        this.logger.log('Kakao template status updated', {
          templateId: template.templateId,
          templateCode,
          status: templateStatus,
        });
      } else {
        this.logger.warn('Kakao template not found for webhook', {
          templateCode,
          kakaoTemplateCode,
        });
      }
    }
  }

  private async saveKakaoReceipt(hook: any, webhookData: any): Promise<void> {
    await this.db.insert(receipts).values({
      provider: 'nhn-kakao',
      status: webhookData.event,
      providerResponse: {
        requestId: hook.requestId,
        recipientSeq: hook.recipientSeq,
        resultCode: hook.resultCode,
        resultCodeName: hook.resultCodeName,
        receiveDate: hook.receiveDate,
        kakaoMessageType: hook.kakaoMessageType,
      } as Record<string, any>,
      metadata: {
        recipientNo: hook.recipientNo,
        senderGroupingKey: hook.senderGroupingKey,
        recipientGroupingKey: hook.recipientGroupingKey,
      },
      timestamp: new Date(),
    });
  }
}
