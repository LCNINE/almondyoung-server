import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamUnavailableError } from '@app/shared';
import { ALMOND_PRINT_FILE_CONTEXT_ID, ALMOND_PRINT_LINK_EXPIRES_SEC } from '../constants/almond-template.constants';

@Injectable()
export class PrintFileClient {
  private readonly logger = new Logger(PrintFileClient.name);
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = (configService.get<string>('FILE_SERVICE_URL') ?? 'http://localhost:3010').replace(/\/+$/, '');
  }

  async upload(body: Buffer, fileName: string, contentType: string, accessToken: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(body)], { type: contentType }), fileName);
    form.append('contextId', ALMOND_PRINT_FILE_CONTEXT_ID);
    form.append('isPublic', 'false');
    const response = await fetch(`${this.baseUrl}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const data = await this.json<{ data?: { id?: string }; id?: string }>(response, '인쇄 파일 업로드');
    const id = data.data?.id ?? data.id;
    if (!id) throw new UpstreamUnavailableError('인쇄 파일 업로드 응답에 id 가 없습니다.');
    return id;
  }

  async downloadUrl(fileId: string, accessToken: string): Promise<{ url: string; expiresAt: string } | null> {
    const response = await fetch(
      `${this.baseUrl}/files/${fileId}/download?download=true&expiresIn=${ALMOND_PRINT_LINK_EXPIRES_SEC}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (response.status === 404) return null;
    const data = await this.json<{
      data?: { signedUrl?: string; expiresAt?: string };
      signedUrl?: string;
      expiresAt?: string;
    }>(response, '인쇄 파일 링크 발급');
    const signed = data.data ?? data;
    if (!signed.signedUrl) throw new UpstreamUnavailableError('인쇄 파일 링크 응답에 signedUrl 이 없습니다.');
    return { url: signed.signedUrl, expiresAt: String(signed.expiresAt ?? '') };
  }

  private async json<T>(response: Response, action: string): Promise<T> {
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`${action} 실패 ${response.status}: ${detail.slice(0, 500)}`);
      throw new UpstreamUnavailableError(`${action}에 실패했습니다.`);
    }
    return (await response.json()) as T;
  }
}
