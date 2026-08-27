import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { PhoneVerificationException } from '../exceptions/phone-verification.exceptions';

/**
 * 인증문자 발송을 notification 서비스에 위임한다.
 *
 * 발송 채널은 전부 notification 이 소유한다 — user-service 는 인증 코드의 생성·저장·검증만
 * 담당하고, 어느 벤더로 어떻게 나가는지는 알지 않는다. 이 서비스가 여기 있던 Twilio 직접
 * 호출을 대신한다.
 *
 * Kafka 가 아니라 동기 HTTP 인 이유: 사용자가 "인증번호 받기" 를 누르고 화면에서 기다린다.
 * 비동기로 던지면 발송 실패를 그 자리에서 알려줄 수 없어 "발송했습니다" 를 띄운 채 문자가 안
 * 가는 상태가 된다.
 */
@Injectable()
export class SmsSenderService {
  private readonly logger = new Logger(SmsSenderService.name);
  private client?: AxiosInstance;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): AxiosInstance {
    if (this.client) return this.client;

    const baseURL = this.configService.get<string>('NOTIFICATION_SERVICE_URL');
    const internalKey = this.configService.get<string>('NOTIFICATION_INTERNAL_KEY');

    if (!baseURL || !internalKey) {
      this.logger.error('NOTIFICATION_SERVICE_URL / NOTIFICATION_INTERNAL_KEY 가 설정되지 않았다');
      throw new PhoneVerificationException({
        message: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요',
        errorCode: 'SMS_SEND_NOT_CONFIGURED',
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }

    this.client = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalKey}`,
      },
    });

    return this.client;
  }

  async send(to: string, content: string): Promise<void> {
    let response: { success: boolean; error?: string; provider?: string };

    try {
      const { data } = await this.getClient().post<{ success: boolean; error?: string; provider?: string }>(
        '/internal/sms/send',
        { to, content },
      );
      response = data;
    } catch (error: unknown) {
      // 위 getClient() 가 던진 설정 누락 예외를 여기서 삼키면 사유가 지워진다.
      if (error instanceof PhoneVerificationException) throw error;

      const axiosError = axios.isAxiosError<unknown>(error) ? error : undefined;

      this.logger.error('notification SMS 발송 호출 실패', {
        status: axiosError?.response?.status,
        data: axiosError?.response?.data,
        message: error instanceof Error ? error.message : String(error),
      });

      throw new PhoneVerificationException({
        message: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요',
        errorCode: 'SMS_SEND_FAILED',
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }

    // HTTP 는 201 이어도 발송이 실패했을 수 있다. 프로바이더 판정을 그대로 확인해야
    // "발송했습니다" 만 띄우고 문자는 안 가는 상태를 막는다.
    if (!response.success) {
      this.logger.error('SMS 발송 실패', { provider: response.provider, error: response.error });

      throw new PhoneVerificationException({
        message: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요',
        errorCode: 'SMS_SEND_FAILED',
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
  }
}
