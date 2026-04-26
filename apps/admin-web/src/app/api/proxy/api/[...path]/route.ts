import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const ALMONDYOUNG_API_URL = process.env.ALMONDYOUNG_API_URL ?? 'http://localhost:3000';

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ALMONDYOUNG_API_URL, path);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ALMONDYOUNG_API_URL, path);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ALMONDYOUNG_API_URL, path);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ALMONDYOUNG_API_URL, path);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, ALMONDYOUNG_API_URL, path);
}
