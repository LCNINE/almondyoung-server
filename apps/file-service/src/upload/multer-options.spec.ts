import { Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { UPLOAD_MULTER_OPTIONS } from './multer-options';

const KOREAN_FILENAME = '상품일괄양식_2026-08-04.xlsx';

/**
 * 업로드 경계에서 한글 파일명이 살아남는지만 본다. UploadController 를 그대로 띄우면
 * UploadService → DB/S3 의존까지 끌고 와야 하는데, 검증 대상은 그 앞단(multipart 파라미터
 * 디코딩)이라 인터셉터만 태우는 최소 컨트롤러로 충분하다.
 */
@Controller('probe')
class ProbeController {
  @Post()
  @UseInterceptors(FileInterceptor('file', UPLOAD_MULTER_OPTIONS))
  echo(@UploadedFile() file: Express.Multer.File): { originalname: string } {
    return { originalname: file.originalname };
  }
}

/**
 * supertest 의 `res.body` 는 `any` 다 — 캐스팅 대신 `in` 내로잉으로 실제 검증한다
 * (form-export-file.client.ts 의 추출기들과 같은 관례).
 */
function readOriginalName(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'originalname' in body && typeof body.originalname === 'string') {
    return body.originalname;
  }
  throw new Error('응답 본문에 originalname 이 없습니다');
}

describe('업로드 multer 옵션', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * busboy 는 defParamCharset 이 없으면 multipart 파라미터를 latin-1 로 읽는다
   * (busboy/lib/types/multipart.js 의 nullDecoder). 그러면 `상품…` 의 UTF-8 바이트가
   * `ì\x83\x81…` 로 들어와 그대로 uploads.original_name 에 저장되고, 다운로드가
   * RFC 5987 로 정확히 실어 보내도 사용자에게는 깨진 이름이 떨어진다.
   */
  it('한글 파일명을 UTF-8 로 디코딩한다', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.from('xlsx-bytes'), { filename: KOREAN_FILENAME });

    expect(res.status).toBe(201);
    expect(readOriginalName(res.body)).toBe(KOREAN_FILENAME);
  });

  it('ASCII 파일명을 그대로 둔다', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.from('xlsx-bytes'), { filename: 'plain-form.xlsx' });

    expect(res.status).toBe(201);
    expect(readOriginalName(res.body)).toBe('plain-form.xlsx');
  });
});
