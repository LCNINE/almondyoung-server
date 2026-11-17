import { CustomError } from '@/lib/api/customError';
import { UploadRejectedError } from '@/lib/api/domains/files/upload.client';
import {
  isValidationRejection,
  SHAPE_LIMIT_MESSAGE,
  uploadErrorMessage,
} from './upload-error-message';

describe('uploadErrorMessage', () => {
  // core GlobalExceptionFilter 는 class-validator 의 message 배열을 첫 문자열로 평탄화하고 code 에 Nest 의 error 필드('Bad Request')를 싣는다.
  const validationBody = {
    success: false,
    error: 'Bad Request',
    code: 'Bad Request',
    message: 'rows must contain no more than 5000 elements',
  };

  it('class-validator 400(본문 code 가 Bad Request)은 한도 안내로 바꾼다', () => {
    const err = new CustomError({
      message: 'rows must contain no more than 5000 elements',
      statusCode: 400,
      response: validationBody,
    });
    expect(isValidationRejection(err)).toBe(true);
    expect(uploadErrorMessage(err)).toBe(SHAPE_LIMIT_MESSAGE);
  });

  it('도메인 BadRequestError(code BAD_REQUEST)는 검증 거절이 아니다', () => {
    const err = new CustomError({
      message: '필수 열이 없습니다: 바코드',
      statusCode: 400,
      response: {
        success: false,
        code: 'BAD_REQUEST',
        message: '필수 열이 없습니다: 바코드',
      },
    });
    expect(isValidationRejection(err)).toBe(false);
  });

  it('400 문자열 메시지(core 한국어)는 그대로 보인다', () => {
    const err = new CustomError({
      message: '필수 열이 없습니다: 바코드',
      statusCode: 400,
      response: {
        success: false,
        code: 'BAD_REQUEST',
        message: '필수 열이 없습니다: 바코드',
      },
    });
    expect(uploadErrorMessage(err)).toBe('필수 열이 없습니다: 바코드');
  });

  it('그 밖의 CustomError 는 message 그대로', () => {
    const err = new CustomError({
      message: '서버 오류',
      statusCode: 409,
      response: { code: 'Bad Request', message: 'x' },
    });
    expect(uploadErrorMessage(err)).toBe('서버 오류');
  });

  it('원본 보관 실패의 cause(Error·UploadRejectedError)는 message 를 보인다', () => {
    expect(
      uploadErrorMessage(
        new UploadRejectedError('파일 업로드가 거부되었습니다. (너무 큼)')
      )
    ).toBe('파일 업로드가 거부되었습니다. (너무 큼)');
    expect(uploadErrorMessage(new Error('presign failed (status: 500)'))).toBe(
      'presign failed (status: 500)'
    );
  });

  it('알 수 없는 값은 기본 문구', () => {
    expect(uploadErrorMessage(undefined)).toBe('올리지 못했습니다.');
  });
});
