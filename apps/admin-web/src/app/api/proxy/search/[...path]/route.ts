import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const SEARCH_SERVICE_URL = process.env.SEARCH_SERVICE_URL ?? 'http://localhost:3004';

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, SEARCH_SERVICE_URL, path);
}
