// apps/notification/src/provider/providers/sms/nhn-sms.provider.ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  NotificationProvider,
  NotificationMessage,
  NotificationResult,
  BulkNotificationResult,
} from '../../interfaces/notification-provider.interface';
import { StructuredLogger } from '../../../shared/utils/logger.utils';

/**
 * NHN Cloud SMS
 */
interface NHNSmsConfig {
  apiUrl: string;
  appKey: string;
  secretKey: string;
  sendNo: string;
  timeout: number;
}

interface NHNSmsResponse {
  header: {
    isSuccessful: boolean;
    resultCode: number;
    resultMessage: string;
  };
  body?: {
    data?: {
      requestId: string;
      statusCode: string;
      sendResultList?: Array<{
        recipientNo: string;
        resultCode?: number;
        resultMessage?: string;
        recipientSeq: number;
      }>;
    };
  };
}

// 단문(SMS) 한도. 넘으면 NHN 이 거부하므로 장문(MMS) 엔드포인트로 갈라 보낸다.
const SMS_BODY_BYTE_LIMIT = 90;

export class NHNSmsProvider implements NotificationProvider {
  private readonly logger: StructuredLogger;
  private readonly providerId: string;
  private readonly config: NHNSmsConfig;
  private readonly client: AxiosInstance;

  constructor(
    providerId: string,
    config: Record<string, any>,
    private readonly configService: ConfigService,
  ) {
    this.logger = new StructuredLogger(new Logger(NHNSmsProvider.name));
    this.providerId = providerId;

    const given = config as Partial<NHNSmsConfig>;

    this.config = {
      apiUrl:
        given.apiUrl || this.configService.get<string>('NHN_SMS_API_URL') || 'https://sms.api.nhncloudservice.com',
      appKey: given.appKey || this.configService.get<string>('NHN_SMS_APP_KEY') || '',
      secretKey: given.secretKey || this.configService.get<string>('NHN_SMS_SECRET_KEY') || '',
      sendNo: given.sendNo || this.configService.get<string>('NHN_SMS_SEND_NO') || '',
      timeout: given.timeout || 30000,
    };

    if (!this.config.appKey) {
      throw new Error('NHN_SMS_APP_KEY is required');
    }
    if (!this.config.secretKey) {
      throw new Error('NHN_SMS_SECRET_KEY is required');
    }
    // 발신번호는 NHN 콘솔에 사전등록된 것만 통과한다. 미등록 번호로 보내면 발송이 거부된다.
    if (!this.config.sendNo) {
      throw new Error('NHN_SMS_SEND_NO is required');
    }

    this.client = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Secret-Key': this.config.secretKey,
      },
    });

    this.logger.log('NHN SMS provider initialized', {
      apiUrl: this.config.apiUrl,
      sendNo: this.config.sendNo,
    });
  }

  getName(): string {
    return 'NHN SMS';
  }

  getProviderId(): string {
    return this.providerId;
  }

  /**
   * 프로브를 두지 않는다. 발송 API 응답이 유일하게 믿을 수 있는 판정이고, 부수적인 조회 API 로
   * 가용성을 추정하면 그 추정이 틀렸을 때 문자가 발송 시도조차 없이 버려진다.
   */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    const results = await this.sendBatch([message]);
    return results[0];
  }

  async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
    // NHN 은 recipientList 로 최대 1,000명까지 한 번에 받는다. 다만 한 요청에 본문은 하나뿐이라
    // 본문이 같은 것끼리 묶어야 배치가 성립한다.
    const byContent = new Map<string, NotificationMessage[]>();
    for (const message of messages) {
      const group = byContent.get(message.content) ?? [];
      group.push(message);
      byContent.set(message.content, group);
    }

    // 결과를 원본 메시지와 짝지어 들고 다닌다. 묶는 순간 순서가 어긋나므로 index 로 되짚으면
    // 실패한 수신번호가 엉뚱하게 기록된다.
    const pairs: Array<{ message: NotificationMessage; result: NotificationResult }> = [];
    for (const group of byContent.values()) {
      for (let i = 0; i < group.length; i += 1000) {
        const batch = group.slice(i, i + 1000);
        const batchResults = await this.sendBatch(batch);
        batch.forEach((message, index) => pairs.push({ message, result: batchResults[index] }));
      }
    }

    const failures = pairs
      .filter(({ result }) => !result.success)
      .map(({ message, result }) => ({ to: message.to, error: result.error ?? 'Unknown error' }));
    const successCount = pairs.length - failures.length;

    return {
      successCount,
      failureCount: failures.length,
      results: pairs.length > 0 ? pairs.map(({ result }) => result) : undefined,
      failures: failures.length > 0 ? failures : undefined,
    };
  }

  private async sendBatch(messages: NotificationMessage[]): Promise<NotificationResult[]> {
    const body = messages[0].content;
    const endpoint = this.isLongMessage(body) ? 'mms' : 'sms';

    try {
      const response = await this.client.post<NHNSmsResponse>(
        `/sms/v3.0/appKeys/${this.config.appKey}/sender/${endpoint}`,
        {
          body,
          sendNo: this.config.sendNo,
          ...(endpoint === 'mms' ? { title: messages[0].subject || '아몬드영' } : {}),
          recipientList: messages.map((message) => ({
            recipientNo: this.formatPhoneNumber(message.to),
          })),
        },
      );

      const { header, body: responseBody } = response.data;

      // HTTP 200 이어도 header.isSuccessful 이 false 면 실패다. 상태코드만 보면 실패를 성공으로
      // 집계하게 된다.
      if (!header.isSuccessful) {
        this.logger.error('NHN SMS request rejected', {
          resultCode: header.resultCode,
          resultMessage: header.resultMessage,
        });
        return messages.map(() => ({
          success: false,
          error: `${header.resultMessage} (${header.resultCode})`,
          providerResponse: header,
        }));
      }

      const requestId = responseBody?.data?.requestId;
      const sendResults = responseBody?.data?.sendResultList ?? [];

      this.logger.log('SMS sent successfully', {
        requestId,
        endpoint,
        recipientCount: messages.length,
      });

      return messages.map((message) => {
        const recipientNo = this.formatPhoneNumber(message.to);
        const sendResult = sendResults.find((r) => r.recipientNo === recipientNo);

        // 수신자별 resultCode 는 0 이 정상이다. 누락됐으면 요청 자체가 성공했으므로 성공으로 본다.
        const failed = sendResult?.resultCode !== undefined && sendResult.resultCode !== 0;

        return {
          success: !failed,
          messageId: requestId,
          error: failed ? `${sendResult?.resultMessage} (${sendResult?.resultCode})` : undefined,
          providerResponse: { requestId, ...sendResult },
        };
      });
    } catch (error: unknown) {
      const axiosError = axios.isAxiosError<NHNSmsResponse>(error) ? error : undefined;
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error('Failed to send SMS', {
        endpoint,
        recipientCount: messages.length,
        status: axiosError?.response?.status,
        data: axiosError?.response?.data,
        error: message,
      });

      return messages.map(() => ({
        success: false,
        error: axiosError?.response?.data?.header?.resultMessage || message || 'Unknown error',
        providerResponse: axiosError?.response?.data,
      }));
    }
  }

  /**
   * NHN 은 국내 번호를 하이픈 없는 로컬 표기(`01012345678`)로 받는다. E.164(`+821012345678`)를
   * 그대로 넘기면 거부되므로 되돌린다.
   */
  private formatPhoneNumber(phoneNumber: string): string {
    const digits = phoneNumber.replace(/[^\d]/g, '');
    return digits.startsWith('82') ? '0' + digits.substring(2) : digits;
  }

  private isLongMessage(body: string): boolean {
    return Buffer.byteLength(body, 'utf8') > SMS_BODY_BYTE_LIMIT;
  }
}
