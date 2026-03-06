import { NextRequest, NextResponse } from 'next/server';
import { fanOut } from '../../../_lib/fan-out';

type Params = { params: Promise<{ resourceType: string; resourceId: string }> };

interface TraceLinkResponse {
  links: TraceLink[];
  chainIds: string[];
  total: number;
}

export interface TraceLink {
  id: string;
  chainId: string;
  resourceType: string;
  resourceId: string;
  eventType: string;
  createdAt: string;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { resourceType, resourceId } = await params;
  const { searchParams } = request.nextUrl;
  const service = searchParams.get('service') ?? undefined;

  const results = await fanOut<TraceLinkResponse>(
    (baseUrl) =>
      `${baseUrl}/events/trace/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
    service
  );

  const services = results.map((r) => ({
    name: r.name,
    status: r.status,
    links: r.data?.links,
    chainIds: r.data?.chainIds,
    total: r.data?.total,
    error: r.error,
  }));

  return NextResponse.json({ services });
}
