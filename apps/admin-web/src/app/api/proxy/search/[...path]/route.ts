import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const SEARCH_SERVICE_URL = process.env.SEARCH_SERVICE_URL ?? 'http://localhost:3004';

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, SEARCH_SERVICE_URL, path);
}

// 키워드 운영 상태(담당·메모) upsert 용
export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, SEARCH_SERVICE_URL, path);
}
