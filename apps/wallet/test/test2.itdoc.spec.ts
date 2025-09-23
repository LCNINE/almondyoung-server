// apps/wallet/test/upload.single.itdoc.spec.ts
import expressApp from '../src/services/__tests__/expressApp';
import { describeAPI, itDoc, HttpStatus, field, HttpMethod } from 'itdoc';
const FormData = require('form-data');
describeAPI(
  HttpMethod.POST,
  '/upload/single',
  {
    summary: 'BNPL 프로필 + 동의서 업로드',
    tag: 'BNPL',
    description: 'multipart/form-data를 통해 프로필과 파일 업로드',
  },
  expressApp,
  (apiDoc) => {
    itDoc('BNPL 프로필 생성 + 동의서 업로드 성공', async () => {
      const form = new FormData();
      form.append('userId', 'user_123');
      form.append('payerName', '김비엔피엘');
      form.append('phone', '01098765432');
      form.append('paymentCompany', '088'); // 신한은행
      form.append('paymentNumber', '110222333444');
      form.append('payerNumber', '950101');
      form.append('name', '나의 BNPL 계좌');

      // 테스트 파일 생성 및 첨부
      const testFileContent = Buffer.from(
        'This is a test BNPL agreement file.',
      );
      form.append('agreementFile', testFileContent, {
        filename: 'bnpl_agreement.pdf',
        contentType: 'application/pdf',
      });

      await apiDoc
        .test()
        .req()
        .header(form.getHeaders())

        .body(form)
        .res()
        .status(HttpStatus.CREATED)
        .body({
          success: field('성공 여부', 'file uploaded successfully'),
        });
    });
  },
);
