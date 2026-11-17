import {
  NO_CONNECTION_MESSAGE,
  SERVER_BUSY_MESSAGE,
  SERVER_ERROR_MESSAGE,
  UNKNOWN_RESULT_MESSAGE,
  failureMessage,
} from './transport-message';

describe('failureMessage', () => {
  it('reads without a response ask to check the connection', () => {
    expect(failureMessage({ method: 'get' })).toBe(NO_CONNECTION_MESSAGE);
  });

  it('writes without a definite answer say the result is unknown', () => {
    expect(failureMessage({ method: 'post' })).toBe(UNKNOWN_RESULT_MESSAGE);
    expect(
      failureMessage({
        method: 'patch',
        status: 504,
        data: { message: 'Upstream request timed out after 30000ms' },
      })
    ).toBe(UNKNOWN_RESULT_MESSAGE);
    expect(
      failureMessage({
        method: 'post',
        status: 500,
        data: '<html>Internal Server Error</html>',
      })
    ).toBe(UNKNOWN_RESULT_MESSAGE);
  });

  it('reads that hit a busy gateway ask to try again shortly', () => {
    expect(failureMessage({ method: 'get', status: 502 })).toBe(
      SERVER_BUSY_MESSAGE
    );
    expect(
      failureMessage({
        method: 'get',
        status: 504,
        data: { message: 'Upstream request timed out after 30000ms' },
      })
    ).toBe(SERVER_BUSY_MESSAGE);
  });

  it('keeps a Korean message the server wrote for an answered failure', () => {
    expect(
      failureMessage({
        method: 'post',
        status: 502,
        data: {
          code: 'CARRIER_UNAVAILABLE',
          message: '택배사 연결이 끊겼어요.',
        },
      })
    ).toBe('택배사 연결이 끊겼어요.');
  });

  it('replaces developer text in an answered server error', () => {
    expect(
      failureMessage({
        method: 'post',
        status: 500,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Cannot read properties of undefined',
        },
      })
    ).toBe(SERVER_ERROR_MESSAGE);
    expect(
      failureMessage({
        method: 'get',
        status: 503,
        data: { code: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable' },
      })
    ).toBe(SERVER_ERROR_MESSAGE);
  });

  it('never shows the raw transport text', () => {
    for (const method of ['get', 'post', undefined]) {
      for (const status of [undefined, 500, 502, 503, 504]) {
        expect(failureMessage({ method, status })).not.toMatch(
          /Request failed|Network Error|timeout of|status code/
        );
      }
    }
  });
});
