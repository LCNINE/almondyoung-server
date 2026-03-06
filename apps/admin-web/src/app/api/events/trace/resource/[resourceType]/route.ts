import { NextRequest, NextResponse } from 'next/server';
import { fanOut } from '../../_lib/fan-out';

type Params = { params: Promise<{ resourceType: string }> };

interface ResourceListResponse {
  resources: { resourceId: string }[];
  total: number;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { resourceType } = await params;
  const { searchParams } = request.nextUrl;

  const service = searchParams.get('service') ?? undefined;
  const limit = searchParams.get('limit') ?? '20';
  const offset = searchParams.get('offset') ?? '0';

  const results = await fanOut<ResourceListResponse>(
    (baseUrl) =>
      `${baseUrl}/events/trace/resource/${encodeURIComponent(resourceType)}?limit=${limit}&offset=${offset}`,
    service
  );

  const services = results.map((r) => ({
    name: r.name,
    status: r.status,
    resources: r.data?.resources,
    total: r.data?.total,
    error: r.error,
  }));

  return NextResponse.json({ services });
}
