import { NextRequest, NextResponse } from 'next/server';
import { fanOut } from '../../_lib/fan-out';

type Params = { params: Promise<{ chainId: string }> };

interface ChainResponse {
  links: TraceLink[];
  chainIds: string[];
  total: number;
}

interface TraceLink {
  id: string;
  chainId: string;
  resourceType: string;
  resourceId: string;
  eventType: string;
  createdAt: string;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { chainId } = await params;
  const { searchParams } = request.nextUrl;
  const service = searchParams.get('service') ?? undefined;

  const results = await fanOut<ChainResponse>(
    (baseUrl) => `${baseUrl}/events/trace/chain/${encodeURIComponent(chainId)}`,
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
