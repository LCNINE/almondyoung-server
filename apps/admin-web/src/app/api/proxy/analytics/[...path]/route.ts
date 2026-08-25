import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const ANALYTICS_SERVICE_URL =
  process.env.ANALYTICS_SERVICE_URL ?? 'http://localhost:3040';

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ANALYTICS_SERVICE_URL, path);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ANALYTICS_SERVICE_URL, path);
}
