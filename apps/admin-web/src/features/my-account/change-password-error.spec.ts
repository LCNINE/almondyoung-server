import { CustomError } from '@/lib/api/customError';
import { changePasswordErrorMessage } from './change-password-error';

describe('changePasswordErrorMessage', () => {
  it('서버가 거절한 사유(4xx)를 그대로 보여준다', () => {
    const e = new CustomError({
      message:
        '비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.',
      statusCode: 400,
      response: {
        message:
          '비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.',
      },
    });
    expect(changePasswordErrorMessage(e)).toBe(
      '비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.'
    );
  });

  it('현재 비밀번호 불일치도 서버 문구로', () => {
    const e = new CustomError({
      message: '현재 비밀번호가 일치하지 않습니다.',
      statusCode: 400,
    });
    expect(changePasswordErrorMessage(e)).toBe(
      '현재 비밀번호가 일치하지 않습니다.'
    );
  });

  it('서버 오류·네트워크 실패는 일반 문구', () => {
    const generic = '비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해주세요.';
    expect(
      changePasswordErrorMessage(
        new CustomError({ message: 'Network Error', statusCode: 500 })
      )
    ).toBe(generic);
    expect(changePasswordErrorMessage(new TypeError('Failed to fetch'))).toBe(
      generic
    );
    expect(changePasswordErrorMessage(undefined)).toBe(generic);
  });
});
