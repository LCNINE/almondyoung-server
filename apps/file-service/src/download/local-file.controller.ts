import { Controller, Get, Logger, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '@app/authorization';
import { Response } from 'express';
import { promises as fs } from 'fs';
import { localUploadsDir, resolveWithinUploadsDir } from '../storage/local-storage.path';

/**
 * 확장자 → Content-Type. 이 서비스가 다루는 것(상품 이미지·일괄등록 워크북)만 담는다 —
 * 전체 mime DB 를 끌어올 가치가 없고, 모르는 것은 octet-stream 이 정답이다.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * **로컬 개발 전용** 파일 서빙. `STORAGE_PROVIDER=LOCAL` 이 아니면 전부 404 다.
 *
 * `LocalStorageProvider` 는 S3 서명 URL 자리에 `http://localhost:PORT/files/local/<key>` 를
 * 돌려주는데 그 URL 을 받아낼 라우트가 없었다 — 업로드는 디스크에 써지지만 되읽기가 전부
 * 404 라 LOCAL 프로바이더가 사실상 동작하지 않았다. 이 컨트롤러가 그 짝을 채운다.
 *
 * **`@Public()` 인 이유**: 이 URL 은 서명 URL 의 대체물이고, 서명 URL 은 원래 인증 없이
 * 열린다. core 의 `FormExportFileClient.download` 도, 브라우저의 `<img src>` 도 토큰 없이
 * GET 한다. 대신 배포 환경에서 절대 열리지 않게 하는 것이 방어선이고 — S3 스테이지에서는
 * 위 게이트가 404 를 낸다 — 경로 탈출은 `resolveWithinUploadsDir` 이 막는다.
 *
 * 라우트 충돌은 없다: `DownloadController` 의 `files` 라우트는 전부 2세그먼트
 * (`:fileId/download`·`:fileId/metadata`·`public/:fileId`)인데 스토리지 key 는
 * `<prefix>/<year>/<month>/<uuid>.<ext>` 4세그먼트다(`path-builder.service.ts`).
 */
@ApiExcludeController()
@Controller('files/local')
export class LocalFileController {
  private readonly logger = new Logger(LocalFileController.name);
  private readonly baseDir: string;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.baseDir = localUploadsDir(config);
    this.enabled = config.get<string>('STORAGE_PROVIDER', 'S3') === 'LOCAL';
  }

  @Get('*key')
  @Public()
  async serve(
    @Param('key') key: string | string[],
    @Res() res: Response,
    @Query('disposition') disposition?: string,
  ): Promise<void> {
    if (!this.enabled) throw new NotFoundException();

    // Express 5(path-to-regexp v8)는 와일드카드를 세그먼트 배열로 준다. 4 계열은 문자열이라
    // 둘 다 받는다 — 어느 쪽이든 여기서 하나의 key 문자열로 되돌린다.
    const rawKey = Array.isArray(key) ? key.join('/') : key;
    const filePath = resolveWithinUploadsDir(this.baseDir, rawKey);
    if (!filePath) {
      this.logger.warn(`로컬 파일 경로 탈출 시도: ${rawKey}`);
      throw new NotFoundException();
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      throw new NotFoundException();
    }

    const extension = rawKey.slice(rawKey.lastIndexOf('.')).toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream');
    if (disposition) res.setHeader('Content-Disposition', disposition);
    res.send(buffer);
  }
}
