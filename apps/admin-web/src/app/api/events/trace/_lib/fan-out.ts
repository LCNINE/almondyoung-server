import { cookies } from 'next/headers';

export const TRACKED_SERVICES = [
  {
    name: 'user-service',
    envKey: 'USER_SERVICE_URL',
    default: 'http://localhost:3030',
  },
  {
    name: 'channel-adapter',
    envKey: 'CHANNEL_ADAPTER_SERVICE_URL',
    default: 'http://localhost:3070',
  },
  {
    name: 'almondyoung-server',
    envKey: 'ALMONDYOUNG_API_URL',
    default: 'http://localhost:3000',
  },
  {
    name: 'membership',
    envKey: 'MEMBERSHIP_SERVICE_URL',
    default: 'http://localhost:3050',
  },
  {
    name: 'wallet',
    envKey: 'WALLET_SERVICE_URL',
    default: 'http://localhost:3040',
  },
  {
    name: 'notification',
    envKey: 'NOTIFICATION_SERVICE_URL',
    default: 'http://localhost:3060',
  },
] as const;

export type ServiceName = (typeof TRACKED_SERVICES)[number]['name'];

function getServiceUrl(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

async function buildAuthHeaders(): Promise<HeadersInit> {
  const jar = await cookies();
  const accessToken = jar.get('admin_access_token')?.value ?? '';
  const refreshToken = jar.get('admin_refresh_token')?.value ?? '';
  return {
    'Content-Type': 'application/json',
    Cookie: `accessToken=${accessToken}; refreshToken=${refreshToken}`,
  };
}

export interface FanOutResult<T> {
  name: string;
  status: 'fulfilled' | 'rejected';
  data?: T;
  error?: string;
}

export async function fanOut<T>(
  urlBuilder: (baseUrl: string) => string,
  serviceName?: string
): Promise<FanOutResult<T>[]> {
  const headers = await buildAuthHeaders();

  const targets = serviceName
    ? TRACKED_SERVICES.filter((s) => s.name === serviceName)
    : TRACKED_SERVICES;

  const results = await Promise.allSettled(
    targets.map(async (svc) => {
      const baseUrl = getServiceUrl(svc.envKey, svc.default);
      const url = urlBuilder(baseUrl);
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status}: ${text}`);
      }
      return { name: svc.name, data: (await res.json()) as T };
    })
  );

  return results.map((result, i) => {
    const svc = targets[i];
    if (result.status === 'fulfilled') {
      return {
        name: result.value.name,
        status: 'fulfilled',
        data: result.value.data,
      };
    }
    return {
      name: svc.name,
      status: 'rejected',
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    };
  });
}
