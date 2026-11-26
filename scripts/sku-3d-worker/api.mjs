import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export class ApiError extends Error {
  constructor(status, body) {
    super(`서버가 ${status} 로 답했어요: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

// 409 는 lease 를 잃었다는 뜻 — 결과를 버리고 다음 작업으로 간다
export const isLeaseLost = (error) => error instanceof ApiError && error.status === 409;

export function createApi({ serverUrl, tenantId, workerKey }, fetchImpl = fetch) {
  const base = `${serverUrl}/inventory/sku-3d-worker`;
  const headers = { authorization: `Bearer ${workerKey}`, 'x-tenant-id': tenantId };

  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: body === undefined || body instanceof FormData ? headers : { ...headers, 'content-type': 'application/json' },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ApiError(response.status, await response.text().catch(() => ''));
    }

    return response;
  }

  const json = async (method, path, body) => {
    const response = await call(method, path, body);

    return response.status === 204 ? null : response.json();
  };

  return {
    claim: async () => (await json('POST', '/claim', {})).job,
    heartbeat: (job) => json('POST', `/jobs/${job.id}/heartbeat`, { leaseToken: job.leaseToken }),
    session: (job, sessionId) => json('POST', `/jobs/${job.id}/session`, { leaseToken: job.leaseToken, sessionId }),
    events: (job, items) => json('POST', `/jobs/${job.id}/events`, { leaseToken: job.leaseToken, items }),
    inputs: (job) => json('GET', `/jobs/${job.id}/inputs?leaseToken=${job.leaseToken}`),
    download: async (job, fileId) => {
      const response = await call('GET', `/jobs/${job.id}/files/${fileId}?leaseToken=${job.leaseToken}`);

      return Buffer.from(await response.arrayBuffer());
    },
    upload: async (job, path, mimeType) => {
      const form = new FormData();

      // leaseToken 칸을 파일보다 먼저 보낸다
      form.append('leaseToken', job.leaseToken);
      form.append('file', new Blob([await readFile(path)], { type: mimeType }), basename(path));

      return json('POST', `/jobs/${job.id}/files`, form);
    },
    complete: (job, body) => json('POST', `/jobs/${job.id}/complete`, { leaseToken: job.leaseToken, ...body }),
    fail: (job, error, retryable) =>
      json('POST', `/jobs/${job.id}/fail`, { leaseToken: job.leaseToken, error: String(error).slice(0, 2000), retryable }),
  };
}
