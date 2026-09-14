jest.mock('./client', () => ({ refreshAccessToken: jest.fn() }));

import { refreshAccessToken } from './client';
import { fetchWithRefresh } from './fetch-with-refresh';

it('retries the same upload transport and body after refreshing an expired session', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response('{"id":"uploaded"}', { status: 200 }));
  const init = { method: 'POST', body: new FormData() };
  const response = await fetchWithRefresh(
    '/api/proxy/file/files/upload',
    init,
    request
  );
  expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  expect(request.mock.calls).toEqual([
    ['/api/proxy/file/files/upload', init],
    ['/api/proxy/file/files/upload', init],
  ]);
  expect(await response.json()).toEqual({ id: 'uploaded' });
});
