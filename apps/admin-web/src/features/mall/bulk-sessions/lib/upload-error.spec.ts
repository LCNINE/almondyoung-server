import { parseUploadError } from './upload-error';

function httpError(status: number, message?: string): unknown {
  return {
    statusCode: status,
    response: { status, data: message ? { message } : null },
  };
}

describe('parseUploadError', () => {
  it('400 이어도 서버의 정확한 만료 메시지일 때만 양식 만료 안내로 옮긴다', () => {
    expect(
      parseUploadError(
        httpError(
          400,
          '이 양식은 더 이상 사용할 수 없습니다. 양식을 다시 받아 작업해 주세요.'
        )
      )
    ).toBe('양식이 만료되었습니다. 상품 목록에서 양식을 다시 받아 작성해 주세요.');
  });

  it('만료 메시지가 아닌 400(파서의 파일 형태 오류 등)은 서버 메시지를 그대로 보여준다', () => {
    expect(
      parseUploadError(httpError(400, '"상품" 시트 행이 상한(1000)을 초과했습니다. 파일을 나눠 올려주세요.'))
    ).toBe('"상품" 시트 행이 상한(1000)을 초과했습니다. 파일을 나눠 올려주세요.');
  });

  it('403 은 권한 안내다', () => {
    expect(parseUploadError(httpError(403))).toBe(
      '이 기능은 admin·master 권한이 필요합니다.'
    );
  });

  it('413 은 파일 크기 안내다', () => {
    expect(parseUploadError(httpError(413))).toBe(
      '파일이 너무 큽니다. 10MB 이하만 올릴 수 있습니다.'
    );
  });

  it('그 밖은 서버 메시지를 그대로 쓴다', () => {
    expect(parseUploadError(httpError(500, '서버 오류'))).toBe('서버 오류');
  });

  it('메시지가 없으면 기본 문구다', () => {
    expect(parseUploadError(httpError(500))).toBe('업로드에 실패했습니다.');
  });
});
