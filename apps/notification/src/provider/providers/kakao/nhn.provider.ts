// apps/notification/src/provider/providers/kakao/nhn.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  NotificationProvider,
  NotificationMessage,
  NotificationResult,
  BulkNotificationResult,
} from '../../interfaces/notification-provider.interface';
import { StructuredLogger } from '../../../shared/utils/logger.utils';
import { isResendSettingMissing } from './nhn-resend-setting';

interface NHNKakaoConfig {
  apiUrl: string;
  appKey: string;
  secretKey: string;
  senderKey: string;
  plusFriendId: string;
  resendAppKey?: string; // SMS 대체발송용 앱키
}

interface AlimtalkButton {
  ordering: number;
  type: string;
  name: string;
  linkMo?: string;
  linkPc?: string;
  schemeIos?: string;
  schemeAndroid?: string;
}

interface AlimtalkRecipient {
  recipientNo: string;
  templateParameter?: Record<string, string>;
  resendParameter?: {
    isResend: boolean;
    resendType?: 'SMS' | 'LMS';
    resendTitle?: string;
    resendContent?: string;
    resendSendNo?: string;
  };
  buttons?: AlimtalkButton[];
  recipientGroupingKey?: string;
}

/** 발송 응답 중 재시도 판단에 쓰는 부분만 */
interface AlimtalkSendResponse {
  header?: { isSuccessful?: boolean; resultMessage?: string };
}

interface AlimtalkSendRequest {
  senderKey: string;
  templateCode?: string;
  requestDate?: string;
  senderGroupingKey?: string;
  createUser?: string;
  recipientList: AlimtalkRecipient[];
  messageOption?: {
    price?: number;
    currencyType?: string;
  };
  statsId?: string;
}

interface AlimtalkRawMessage {
  senderKey: string;
  templateCode?: string;
  requestDate?: string;
  senderGroupingKey?: string;
  createUser?: string;
  recipientList: Array<{
    recipientNo: string;
    content: string;
    templateTitle?: string;
    buttons?: AlimtalkButton[];
    resendParameter?: {
      isResend: boolean;
      resendType?: 'SMS' | 'LMS';
      resendTitle?: string;
      resendContent?: string;
      resendSendNo?: string;
    };
    recipientGroupingKey?: string;
  }>;
  messageOption?: {
    price?: number;
    currencyType?: string;
  };
  statsId?: string;
}

@Injectable()
export class NHNProvider implements NotificationProvider {
  private readonly logger: StructuredLogger;
  private readonly providerId: string;
  private readonly config: NHNKakaoConfig;
  private readonly client: AxiosInstance;
  private isHealthy: boolean = true;

  constructor(
    providerId: string,
    config: Record<string, any>,
    private readonly configService: ConfigService,
  ) {
    this.logger = new StructuredLogger(new Logger(NHNProvider.name));
    this.providerId = providerId;

    // 설정 초기화 - DB config 우선, 없으면 환경변수
    this.config = {
      apiUrl: config.apiUrl || this.configService.get<string>('NHN_API_URL') || 'https://api-alimtalk.cloud.toast.com',
      appKey: config.appKey || this.configService.get<string>('NHN_APP_KEY')!,
      secretKey: config.secretKey || this.configService.get<string>('NHN_SECRET_KEY')!,
      senderKey: config.senderKey || this.configService.get<string>('NHN_SENDER_KEY')!,
      plusFriendId: config.plusFriendId || this.configService.get<string>('NHN_PLUS_FRIEND_ID') || '@아몬드영',
      resendAppKey: config.resendAppKey || this.configService.get<string>('NHN_SMS_APP_KEY'),
    };

    // 필수 설정값 검증
    if (!this.config.appKey) {
      throw new Error('NHN_APP_KEY is required');
    }
    if (!this.config.secretKey) {
      throw new Error('NHN_SECRET_KEY is required');
    }
    if (!this.config.senderKey) {
      throw new Error('NHN_SENDER_KEY is required');
    }

    // Axios 클라이언트 초기화
    this.client = axios.create({
      baseURL: this.config.apiUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Secret-Key': this.config.secretKey,
      },
    });

    // 응답 인터셉터
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error('NHN API Error', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        throw error;
      },
    );
  }

  getName(): string {
    return 'NHN KakaoTalk';
  }

  getProviderId(): string {
    return this.providerId;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // 템플릿 조회로 헬스체크
      const response = await this.client.get(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`,
        {
          params: { pageSize: 1 },
        },
      );

      this.isHealthy = response.data?.header?.isSuccessful || false;
      return this.isHealthy;
    } catch (error) {
      this.isHealthy = false;
      return false;
    }
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const metadata = message.metadata || {};
      const templateCode = metadata.templateCode;
      const templateParameters = metadata.templateParameters || {};
      const buttons = metadata.buttons || [];

      let response;

      if (templateCode) {
        // 템플릿 치환 발송
        const request: AlimtalkSendRequest = {
          senderKey: this.config.senderKey,
          templateCode,
          ...(typeof metadata.requestDate === 'string' && { requestDate: metadata.requestDate }),
          recipientList: [
            {
              recipientNo: this.formatPhoneNumber(message.to),
              templateParameter: templateParameters,
              buttons: buttons.length > 0 ? buttons : undefined,
              resendParameter: this.resendParameter(metadata),
            },
          ],
          statsId: metadata.statsId,
        };

        response = await this.client.post(this.messagesPath(metadata), request);
        response = await this.withoutResendIfUnconfigured(response, request, metadata);
      } else {
        // 전문 발송
        const rawRequest: AlimtalkRawMessage = {
          senderKey: this.config.senderKey,
          recipientList: [
            {
              recipientNo: this.formatPhoneNumber(message.to),
              content: message.content,
              templateTitle: message.subject,
              buttons: buttons.length > 0 ? buttons : undefined,
            },
          ],
          statsId: metadata.statsId,
        };

        response = await this.client.post(`/alimtalk/v2.3/appkeys/${this.config.appKey}/raw-messages`, rawRequest);
      }

      const result = response.data;
      const sendResult = result.message?.sendResults?.[0];

      if (result.header?.isSuccessful && sendResult?.resultCode === 0) {
        return {
          success: true,
          messageId: result.message?.requestId,
          providerResponse: result,
        };
      } else {
        return {
          success: false,
          error: sendResult?.resultMessage || result.header?.resultMessage || 'Unknown error',
          providerResponse: result,
        };
      }
    } catch (error: any) {
      this.logger.error('Failed to send Kakao message', {
        to: message.to,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        providerResponse: error.response?.data,
      };
    }
  }

  async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
    const results: NotificationResult[] = [];
    const failures: Array<{ to: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    // NHN API는 한 요청에 최대 1000명까지 지원
    const BATCH_SIZE = 1000;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);

      try {
        // 템플릿 코드가 모두 동일한 경우 한번에 발송
        const firstMetadata = batch[0].metadata || {};
        const templateCode = firstMetadata.templateCode;
        const allSameTemplate = batch.every((m) => (m.metadata?.templateCode || '') === templateCode);

        if (allSameTemplate && templateCode) {
          // 동일 템플릿 일괄 발송
          const result = await this.sendBulkWithTemplate(batch, templateCode);
          successCount += result.successCount;
          failureCount += result.failureCount;
          if (result.failures) {
            failures.push(...result.failures);
          }
        } else {
          // 개별 발송
          for (const message of batch) {
            const result = await this.send(message);
            results.push(result);

            if (result.success) {
              successCount++;
            } else {
              failureCount++;
              failures.push({
                to: message.to,
                error: result.error || 'Unknown error',
              });
            }
          }
        }
      } catch (error: any) {
        this.logger.error('Bulk send batch failed', {
          batchIndex: i / BATCH_SIZE,
          error: error.message,
        });

        // 배치 실패 시 모든 메시지를 실패로 처리
        batch.forEach((message) => {
          failureCount++;
          failures.push({
            to: message.to,
            error: 'Batch processing failed',
          });
        });
      }
    }

    return {
      successCount,
      failureCount,
      results: results.length > 0 ? results : undefined,
      failures: failures.length > 0 ? failures : undefined,
    };
  }

  private async sendBulkWithTemplate(
    messages: NotificationMessage[],
    templateCode: string,
  ): Promise<BulkNotificationResult> {
    try {
      const recipientList: AlimtalkRecipient[] = messages.map((message) => ({
        recipientNo: this.formatPhoneNumber(message.to),
        templateParameter: message.metadata?.templateParameters || {},
        buttons: message.metadata?.buttons || undefined,
        recipientGroupingKey: message.metadata?.userId,
      }));

      const request: AlimtalkSendRequest = {
        senderKey: this.config.senderKey,
        templateCode,
        recipientList,
        statsId: messages[0].metadata?.statsId,
      };

      const response = await this.client.post(this.messagesPath(messages[0].metadata || {}), request);

      const result = response.data;
      const sendResults = result.message?.sendResults || [];

      let successCount = 0;
      let failureCount = 0;
      const failures: Array<{ to: string; error: string }> = [];

      sendResults.forEach((sendResult: any, index: number) => {
        if (sendResult.resultCode === 0) {
          successCount++;
        } else {
          failureCount++;
          failures.push({
            to: messages[index].to,
            error: sendResult.resultMessage || 'Unknown error',
          });
        }
      });

      return {
        successCount,
        failureCount,
        failures: failures.length > 0 ? failures : undefined,
      };
    } catch (error: any) {
      return {
        successCount: 0,
        failureCount: messages.length,
        failures: messages.map((m) => ({
          to: m.to,
          error: error.message,
        })),
      };
    }
  }

  private formatPhoneNumber(phoneNumber: string): string {
    // 한국 전화번호 형식으로 변환
    let cleaned = phoneNumber.replace(/[^\d]/g, '');

    // 국제번호 형식 처리
    if (cleaned.startsWith('82')) {
      cleaned = '0' + cleaned.substring(2);
    } else if (cleaned.startsWith('+82')) {
      cleaned = '0' + cleaned.substring(3);
    }

    // 010-1234-5678 형식으로 변환
    if (cleaned.length === 11 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    } else if (cleaned.length === 10 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }

    return phoneNumber;
  }

  /**
   * 인증 메시지 주소는 본문에 인증 문구(인증·비밀번호·auth 등)가 없으면 NHN 이 발송을 거부한다.
   * 인증번호처럼 호출자가 명시한 경우에만 그쪽으로 보낸다.
   */
  private messagesPath(metadata: Record<string, any>): string {
    const auth = metadata.alimtalkMessageType === 'AUTH' ? 'auth/' : '';
    return `/alimtalk/v2.3/appkeys/${this.config.appKey}/${auth}messages`;
  }

  /**
   * 알림톡이 실패하면(카카오 미사용자·차단 등) NHN 이 문자로 대신 보낸다. 호출자가 켠 경우에만 싣는다 —
   * 없으면 지금처럼 알림톡만 시도한다. 대체 본문을 따로 주지 않으면 NHN 이 템플릿 본문과 버튼 링크로
   * 만들어 보내므로 알림톡과 같은 말이 나간다.
   */
  private resendParameter(metadata: Record<string, any>): AlimtalkRecipient['resendParameter'] {
    const content: unknown = metadata.resendContent;
    const hasContent = typeof content === 'string' && content.length > 0;
    if (!hasContent && metadata.smsFallback !== true) return undefined;
    return {
      isResend: true,
      ...(hasContent && { resendType: this.getResendType(content), resendContent: content }),
      ...(typeof metadata.resendTitle === 'string' && { resendTitle: metadata.resendTitle }),
      resendSendNo:
        metadata.resendSendNo ||
        this.configService.get<string>('NHN_SMS_SEND_NO') ||
        this.configService.get<string>('DEFAULT_SMS_NUMBER'),
    };
  }

  /**
   * 발신 프로필에 대체 발송 설정이 빠져 있으면 NHN 이 알림톡까지 통째로 거절한다. 그때는 대체 발송을 빼고
   * 알림톡만 한 번 더 보낸다 — 문자 안전망은 잃어도 알림 자체가 사라지지는 않게.
   * 인증번호는 호출자가 문자 대체를 따로 맡으므로 여기서 다시 보내지 않는다.
   */
  private async withoutResendIfUnconfigured(
    response: AxiosResponse<AlimtalkSendResponse>,
    request: AlimtalkSendRequest,
    metadata: Record<string, unknown>,
  ): Promise<AxiosResponse<AlimtalkSendResponse>> {
    const header = response.data?.header;
    const hasResend = request.recipientList.some((recipient) => recipient.resendParameter);
    if (header?.isSuccessful || !hasResend || metadata.alimtalkMessageType === 'AUTH') return response;
    if (!isResendSettingMissing(header?.resultMessage)) return response;

    this.logger.warn('발신 프로필에 대체 발송 설정이 없어 알림톡만 다시 보낸다', {
      templateCode: request.templateCode,
    });
    return this.client.post<AlimtalkSendResponse>(this.messagesPath(metadata), {
      ...request,
      // undefined 칸은 JSON 으로 나가지 않는다
      recipientList: request.recipientList.map((recipient) => ({ ...recipient, resendParameter: undefined })),
    });
  }

  private getResendType(content: string): 'SMS' | 'LMS' {
    // 90바이트 기준으로 SMS/LMS 구분
    const byteLength = Buffer.byteLength(content, 'utf8');
    return byteLength > 90 ? 'LMS' : 'SMS';
  }

  // 템플릿 관련 메서드들
  async registerTemplate(templateData: any): Promise<any> {
    try {
      const response = await this.client.post(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`,
        templateData,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to register template', {
        error: error.message,
        response: error.response?.data,
      });
      throw error;
    }
  }

  async createTemplate(templateData: any): Promise<any> {
    try {
      const requestBody = {
        templateCode: templateData.templateCode,
        templateName: templateData.templateName,
        templateContent: templateData.templateContent,
        templateMessageType: templateData.templateMessageType || 'BA',
        templateEmphasizeType: templateData.templateEmphasizeType || 'NONE',
        templateExtra: templateData.templateExtra,
        templateTitle: templateData.templateTitle,
        templateSubtitle: templateData.templateSubtitle,
        templateHeader: templateData.templateHeader,
        templateItem: templateData.templateItem,
        templateItemHighlight: templateData.templateItemHighlight,
        templateRepresentLink: templateData.templateRepresentLink,
        templateImageName: templateData.templateImageName,
        templateImageUrl: templateData.templateImageUrl,
        securityFlag: templateData.securityFlag || false,
        categoryCode: templateData.categoryCode || '999999',
        buttons: templateData.buttons || [],
        quickReplies: templateData.quickReplies || [],
      };

      const response = await this.client.post(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`,
        requestBody,
      );

      this.logger.log('NHN KakaoTalk template created successfully', {
        templateCode: templateData.templateCode,
        response: response.data,
      });

      return {
        templateCode: templateData.templateCode,
        templateId: response.data.templateId,
        status: 'PENDING',
        ...response.data,
      };
    } catch (error) {
      this.logger.error('Failed to create NHN KakaoTalk template', {
        templateCode: templateData.templateCode,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  async getTemplates(): Promise<any> {
    try {
      const response = await this.client.get(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`,
      );

      this.logger.log('NHN KakaoTalk templates retrieved successfully', {
        count: response.data.templates?.length || 0,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get NHN KakaoTalk templates', {
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  async getMessageStatus(requestId: string, recipientSeq?: number): Promise<any> {
    try {
      const url =
        recipientSeq !== undefined
          ? `/alimtalk/v2.3/appkeys/${this.config.appKey}/auth/messages/${requestId}/${recipientSeq}`
          : `/alimtalk/v2.3/appkeys/${this.config.appKey}/auth/messages?requestId=${requestId}`;

      const response = await this.client.get(url);
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to get message status', {
        requestId,
        error: error.message,
      });
      throw error;
    }
  }

  getConfig(): NHNKakaoConfig {
    return this.config;
  }

  // NHN 카카오톡 템플릿 상세 조회
  async getTemplateDetail(templateCode: string): Promise<any> {
    try {
      const response = await this.client.get(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates/${templateCode}`,
      );

      this.logger.log('NHN KakaoTalk template detail retrieved successfully', {
        templateCode,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get NHN KakaoTalk template detail', {
        templateCode,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // NHN 카카오톡 템플릿 수정
  async updateTemplate(templateCode: string, updateData: any): Promise<any> {
    try {
      const response = await this.client.put(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates/${templateCode}`,
        updateData,
      );

      this.logger.log('NHN KakaoTalk template updated successfully', {
        templateCode,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to update NHN KakaoTalk template', {
        templateCode,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  // NHN 카카오톡 템플릿 삭제
  async deleteTemplate(templateCode: string): Promise<any> {
    try {
      const response = await this.client.delete(
        `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates/${templateCode}`,
      );

      this.logger.log('NHN KakaoTalk template deleted successfully', {
        templateCode,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to delete NHN KakaoTalk template', {
        templateCode,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }
}
