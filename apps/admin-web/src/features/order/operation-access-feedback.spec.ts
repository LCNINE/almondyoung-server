import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PermissionAction,
  ServerDenyFeedback,
} from './operation-access-feedback';

describe('fulfillment operation access components', () => {
  it('does not render a privileged action when the permission is absent', () => {
    const denied = renderToStaticMarkup(
      createElement(
        PermissionAction,
        { allowed: false },
        createElement('button', null, '배치 생성')
      )
    );
    const allowed = renderToStaticMarkup(
      createElement(
        PermissionAction,
        { allowed: true },
        createElement('button', null, '배치 생성')
      )
    );

    expect(denied).not.toContain('배치 생성');
    expect(allowed).toContain('배치 생성');
  });

  it.each([
    [403, '권한이 없어 서버가 작업을 거부했습니다. missing operate scope'],
    [409, '상태가 변경되어 서버가 작업을 거부했습니다. stale manifest'],
  ])('renders the server denial for HTTP %s', (status, expected) => {
    const markup = renderToStaticMarkup(
      createElement(ServerDenyFeedback, {
        error: {
          response: { status, data: { message: expected.split('. ')[1] } },
        },
        fallback: '작업에 실패했습니다.',
      })
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(expected);
  });
});
