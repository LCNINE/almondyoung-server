import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamUnavailableError } from '@app/shared';
import {
  ALMOND_PRINT_IMAGE_FETCH_TIMEOUT_MS,
  ALMOND_PRINT_MAX_IMAGE_BYTES,
} from '../constants/almond-template.constants';
import { assertPrintReadySvg, sniffImageMime } from '../print/almond-print-svg';

@Injectable()
export class PublicFileClient {
  private readonly logger = new Logger(PublicFileClient.name);
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = (configService.get<string>('FILE_SERVICE_URL') ?? 'http://localhost:3010').replace(/\/+$/, '');
  }

  async fetchImageDataUri(fileId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/files/public/${fileId}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(ALMOND_PRINT_IMAGE_FETCH_TIMEOUT_MS),
    }).catch((error: unknown) => {
      this.logger.error(`공개 파일 조회 실패 fileId=${fileId}: ${String(error)}`);
      throw new UpstreamUnavailableError(`시안 이미지를 받을 수 없습니다: ${fileId}`);
    });

    if (!response.ok) {
      this.logger.warn(`공개 파일 조회 ${response.status} fileId=${fileId}`);
      throw new UpstreamUnavailableError(`시안 이미지를 받을 수 없습니다: ${fileId}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > ALMOND_PRINT_MAX_IMAGE_BYTES) {
      throw new UpstreamUnavailableError(`시안 이미지가 너무 큽니다: ${fileId}`);
    }

    const mime = sniffImageMime(bytes);
    if (!mime) throw new UpstreamUnavailableError(`인쇄에 쓸 수 없는 이미지 형식입니다: ${fileId}`);
    if (mime === 'image/svg+xml') assertPrintReadySvg(bytes.toString('utf8'));

    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
}
