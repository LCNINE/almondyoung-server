import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const MEDUSA_API_URL = process.env.MEDUSA_API_URL ?? 'http://localhost:9000';
const MEDUSA_API_KEY = process.env.MEDUSA_API_KEY ?? '';

type Params = { params: Promise<{ path: string[] }> };

function medusaExtraHeaders(): Record<string, string> | undefined {
  if (!MEDUSA_API_KEY) return undefined;
  const basicAuth = Buffer.from(`${MEDUSA_API_KEY}:`).toString('base64');
  return { Authorization: `Basic ${basicAuth}` };
}

function forwardToMedusa(request: NextRequest, path: string[]) {
  return forwardRequest(request, MEDUSA_API_URL, path, {
    extraHeaders: medusaExtraHeaders(),
    forwardAuthCookie: false,
  });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}
