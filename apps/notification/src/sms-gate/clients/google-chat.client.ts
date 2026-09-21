import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class GoogleChatClient {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!this.configService.get<string>('GOOGLE_CHAT_WEBHOOK_URL');
  }

  async send(text: string): Promise<void> {
    const url = this.configService.get<string>('GOOGLE_CHAT_WEBHOOK_URL');
    if (!url) throw new Error('GOOGLE_CHAT_WEBHOOK_URL is not configured');
    await axios.post(url, { text }, { timeout: REQUEST_TIMEOUT_MS });
  }
}
