import { describeAPI, itDoc, field, HttpMethod, HttpStatus } from 'itdoc';
import { getTsid } from 'tsid-ts';
import * as path from 'path';
import * as fs from 'fs';
import * as FormData from 'form-data';
import { concatAll } from 'rxjs';

// 여기서는 global.d.ts 덕분에 declare global 불필요
beforeAll(async () => {
  if (!global.__APP__) {
    throw new Error('앱이 globalSetup에서 초기화되지 않았습니다.');
  }
});

// 리소스 정리
afterAll(async () => {
  if (global.__NEST_APP__) {
    await global.__NEST_APP__.close();
  }
  if (global.__MODULE_REF__) {
    await global.__MODULE_REF__.close();
  }
});

describeAPI(
  HttpMethod.POST,
  '/v2/payments/hms-bnpl/onboard',
  {
    summary: 'HMS BNPL 프로필 및 동의서 등록',
    tag: 'BNPL',
    description: 'BNPL 프로필을 생성하고 출금 동의서를 업로드합니다.',
  },
  global.__APP__,
  (apiDoc) => {
    itDoc('BNPL 프로필 생성 성공', async () => {
      const testFileContent = Buffer.from(
        'This is a test BNPL agreement file.',
      );
      const base64Content = testFileContent.toString('base64');

      return apiDoc
        .test()
        .prettyPrint()
        .req()
        .header({
          'Content-Type': field('Content Type', 'multipart/form-data') as any,
        })
        .body({
          // 파일을 문자열이나 간단한 값으로 표현
          agreementFile: field('동의서 파일 (Base64)', base64Content),
        })
        .res()
        .status(HttpStatus.CREATED)
        .body({
          success: field('성공 여부', true),
        });
    });

    // 나머지 테스트는 그대로...
  },
);
