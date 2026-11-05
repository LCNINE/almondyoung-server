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

  it('explains an under-reserved shipment as a stock shortage instead of a state race', () => {
    const message = getServerDenyMessage({
      response: {
        status: 409,
        data: { code: 'SHIPMENT_NOT_FULLY_RESERVED', message: 'Under-reserved lines: l-1' },
      },
    });

    expect(message).toContain('재고가 부족해');
    expect(message).not.toContain('다른 작업으로 상태가 변경되어');
  });

  it('exposes the unwrapped body details, undefined when absent', () => {
    const details = { boxes: [] };
    expect(
      parseServerError({ statusCode: 409, response: { code: 'X', details } }).details,
    ).toBe(details);
    expect(
      parseServerError({ response: { status: 409, data: { code: 'X', details } } }).details,
    ).toBe(details);
    expect(parseServerError({ response: { status: 409, data: { code: 'X' } } }).details).toBeUndefined();
  });
});
