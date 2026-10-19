import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamUnavailableError } from '@app/shared';
import {
  ALMOND_FONT_FETCH_TIMEOUT_MS,
  ALMOND_FONT_MAX_BYTES,
  ALMOND_PRINT_IMAGE_FETCH_TIMEOUT_MS,
  ALMOND_PRINT_MAX_IMAGE_BYTES,
} from '../constants/almond-template.constants';
import { type AlmondFontFormat, sniffFontFormat } from '../print/almond-print-fonts';
import { assertPrintReadySvg, sniffImageMime } from '../print/almond-print-svg';

@Injectable()
export class PublicFileClient {
  private readonly logger = new Logger(PublicFileClient.name);
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = (configService.get<string>('FILE_SERVICE_URL') ?? 'http://localhost:3010').replace(/\/+$/, '');
  }

  async fetchImageDataUri(fileId: string): Promise<string> {
    const bytes = await this.fetchPublic(
      fileId,
      ['시안 이미지를', '시안 이미지가'],
      ALMOND_PRINT_MAX_IMAGE_BYTES,
      ALMOND_PRINT_IMAGE_FETCH_TIMEOUT_MS,
    );
    const mime = sniffImageMime(bytes);
    if (!mime) throw new UpstreamUnavailableError(`인쇄에 쓸 수 없는 이미지 형식입니다: ${fileId}`);
    if (mime === 'image/svg+xml') assertPrintReadySvg(bytes.toString('utf8'));

    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  // 글꼴이 아니면 format 이 null 이다. 등록은 400, 인쇄는 실패로 다르게 다룬다
  async fetchFont(fileId: string): Promise<{ bytes: Buffer; format: AlmondFontFormat | null }> {
    const bytes = await this.fetchPublic(
      fileId,
      ['글꼴을', '글꼴이'],
      ALMOND_FONT_MAX_BYTES,
      ALMOND_FONT_FETCH_TIMEOUT_MS,
    );
    return { bytes, format: sniffFontFormat(bytes) };
  }

  private async fetchPublic(
    fileId: string,
    [object, subject]: [string, string],
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/files/public/${fileId}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => {
      this.logger.error(`공개 파일 조회 실패 fileId=${fileId}: ${String(error)}`);
      throw new UpstreamUnavailableError(`${object} 받을 수 없습니다: ${fileId}`);
    });

    if (!response.ok) {
      this.logger.warn(`공개 파일 조회 ${response.status} fileId=${fileId}`);
      throw new UpstreamUnavailableError(`${object} 받을 수 없습니다: ${fileId}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new UpstreamUnavailableError(`${subject} 너무 큽니다: ${fileId}`);
    return bytes;
  }
}
