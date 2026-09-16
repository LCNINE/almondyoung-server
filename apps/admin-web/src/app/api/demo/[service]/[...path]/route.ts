import type { NextRequest } from 'next/server';
import { forwardRequest } from '../../../proxy/_lib/forward';
import { isDemoConsoleEnabled } from '@/lib/demo/capabilities';

type Params = { params: Promise<{ service: string; path: string[] }> };

async function handle(request: NextRequest, { params }: Params) {
  if (!isDemoConsoleEnabled(process.env))
    return new Response(null, { status: 404 });
  const { service, path } = await params;
  const route = path.join('/');
  const allowed =
    request.method === 'GET'
      ? (service === 'core' &&
          ['catalog', 'readiness', 'shipments'].includes(route)) ||
        (service === 'channel' &&
          /^(capabilities|dispatch-outcomes|runs(?:\/[0-9a-f-]{36})?)$/.test(
            route
          )) ||
        (service === 'notification' && route === 'logs')
      : (service === 'channel' && route === 'runs') ||
        (service === 'core' && route === 'practice');
  if (!allowed) return new Response(null, { status: 404 });
  if (!request.cookies.get('accessToken')?.value)
    return new Response(null, { status: 401 });
  if (
    request.method !== 'GET' &&
    request.headers.get('origin') !== request.nextUrl.origin
  ) {
    return new Response(null, { status: 403 });
  }
  const target =
    service === 'core'
      ? process.env.ALMONDYOUNG_API_URL
      : service === 'notification'
        ? process.env.NOTIFICATION_SERVICE_URL
        : process.env.CHANNEL_ADAPTER_SERVICE_URL;
  if (!target)
    return Response.json(
      { message: '시연 서비스 연결이 설정되지 않았습니다.' },
      { status: 503 }
    );
  return forwardRequest(
    request,
    target,
    service === 'notification' ? ['demo', 'notifications'] : ['demo', ...path]
  );
}

export const GET = handle;
export const POST = handle;
