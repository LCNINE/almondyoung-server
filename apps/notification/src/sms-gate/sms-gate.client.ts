import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { isAxiosError } from 'axios';

export interface GatewayDevice {
  id: string;
  name: string;
  lastSeen: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function toKrE164(phone: string): string {
  const digits = phone.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('82')) return `+${digits}`;
  if (digits.startsWith('0')) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
}

@Injectable()
export class SmsGateClient {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!this.configService.get<string>('SMS_GATE_USERNAME') && !!this.configService.get<string>('SMS_GATE_PASSWORD');
  }

  async send(phone: string, text: string, deviceId: string): Promise<{ id: string }> {
    try {
      const { data } = await axios.post<{ id?: string }>(
        `${this.baseUrl()}/message?skipPhoneValidation=true`,
        { textMessage: { text }, phoneNumbers: [toKrE164(phone)], deviceId },
        { auth: this.auth(), timeout: REQUEST_TIMEOUT_MS },
      );
      if (!data?.id) throw new Error('SMS Gate 응답에 메시지 id 가 없습니다');
      return { id: data.id };
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        const body = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
        throw new Error(`SMS Gate 오류 ${error.response.status}: ${body}`);
      }
      throw error;
    }
  }

  async listDevices(): Promise<GatewayDevice[]> {
    const { data } = await axios.get<GatewayDevice[]>(`${this.baseUrl()}/devices`, {
      auth: this.auth(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    return data ?? [];
  }

  private baseUrl(): string {
    return this.configService.get<string>('SMS_GATE_BASE_URL') ?? 'https://api.sms-gate.app/3rdparty/v1';
  }

  private auth() {
    return {
      username: this.configService.get<string>('SMS_GATE_USERNAME') ?? '',
      password: this.configService.get<string>('SMS_GATE_PASSWORD') ?? '',
    };
  }
}
