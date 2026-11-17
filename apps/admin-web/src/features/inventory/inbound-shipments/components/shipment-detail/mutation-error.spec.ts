import { CustomError } from '@/lib/api/customError';
import { writeErrorMessage } from './mutation-error';

describe('writeErrorMessage', () => {
  it('검증 400(code Bad Request)은 업로드 한도 문구가 아닌 일반 문구', () => {
    const err = new CustomError({
      message: 'qty must not be greater than 1000000',
      statusCode: 400,
      response: {
        success: false,
        code: 'Bad Request',
        message: 'qty must not be greater than 1000000',
      },
    });
    expect(writeErrorMessage(err)).toBe('입력값이 올바르지 않습니다.');
  });

  it('도메인 한국어 문구(400 BAD_REQUEST·409)는 서버 문구 그대로', () => {
    const bad = new CustomError({
      message: '받은 상자가 있어 고칠 수 없습니다',
      statusCode: 400,
      response: {
        code: 'BAD_REQUEST',
        message: '받은 상자가 있어 고칠 수 없습니다',
      },
    });
    const conflict = new CustomError({
      message: '확정할 수 없습니다: 미확인 2줄',
      statusCode: 409,
      response: { code: 'CONFLICT' },
    });
    expect(writeErrorMessage(bad)).toBe('받은 상자가 있어 고칠 수 없습니다');
    expect(writeErrorMessage(conflict)).toBe('확정할 수 없습니다: 미확인 2줄');
  });

  it('알 수 없는 값은 저장 실패 문구', () => {
    expect(writeErrorMessage(undefined)).toBe('저장하지 못했습니다.');
  });
});
