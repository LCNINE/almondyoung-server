import { uploadErrorMessage } from './upload-error-message';

const axiosLike = (status: number, message: unknown) => ({
  response: { status, data: { message } },
  message: 'Request failed',
});

describe('uploadErrorMessage', () => {
  it('class-validator 400(배열 메시지)은 한도 안내로 바꾼다', () => {
    expect(uploadErrorMessage(axiosLike(400, ['rows must contain no more than 5000 elements']))).toBe(
      '파일 모양이 한도를 넘습니다(열 64개·행 5,000개·칸 2,000자).',
    );
  });

  it('400 문자열 메시지(core 한국어)는 그대로 보인다', () => {
    expect(uploadErrorMessage(axiosLike(400, '필수 열이 없습니다: 바코드'))).toBe('필수 열이 없습니다: 바코드');
  });

  it('그 밖의 오류는 서버 문구나 기본 문구', () => {
    expect(uploadErrorMessage(axiosLike(500, '서버 오류'))).toBe('서버 오류');
    expect(uploadErrorMessage(new Error('boom'))).toBe('boom');
    expect(uploadErrorMessage(undefined)).toBe('올리지 못했습니다.');
  });
});
