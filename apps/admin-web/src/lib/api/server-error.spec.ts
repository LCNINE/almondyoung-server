import { getServerDenyMessage, parseServerError } from './server-error';

describe('server error parser', () => {
  it('preserves Axios 403 code and message', () => {
    const parsed = parseServerError({
      response: {
        status: 403,
        data: { code: 'MISSING_SCOPE', message: 'missing recall scope' },
      },
    });

    expect(parsed).toMatchObject({
      status: 403,
      code: 'MISSING_SCOPE',
      message: 'missing recall scope',
      denied: true,
    });
    expect(
      getServerDenyMessage({
        response: { status: 403, data: { message: 'denied' } },
      })
    ).toContain('권한이 없어 서버가 작업을 거부했습니다. denied');
  });

  it('joins validation messages for Axios 409 and reads normalized CustomError', () => {
    expect(
      parseServerError({
        response: {
          status: 409,
          data: { message: ['manifest stale', 'reload'] },
        },
      })
    ).toMatchObject({
      status: 409,
      message: 'manifest stale, reload',
      conflict: true,
    });
    expect(
      parseServerError({
        statusCode: 409,
        message: 'Request failed',
        response: {
          code: 'STALE_VERSION',
          message: 'reservation version changed',
        },
      })
    ).toMatchObject({
      status: 409,
      code: 'STALE_VERSION',
      message: 'reservation version changed',
    });
  });
});
