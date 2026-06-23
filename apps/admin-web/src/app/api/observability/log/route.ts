import { handleBrowserLogRequest } from '@packages/web-observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleBrowserLogRequest(request, {
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'admin-web',
    component: 'admin-web.browser',
    route: '/api/observability/log',
  });
}
