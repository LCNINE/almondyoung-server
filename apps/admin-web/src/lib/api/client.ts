'use client';

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { CustomError } from './customError';

const REFRESH_LOCK_NAME = 'admin-web:auth-refresh';
const REFRESH_MARKER_KEY = 'admin-web:last-auth-refresh';
// 다른 탭이 직전에 refresh 한 사실을 확인할 때 사용하는 window. user-service refresh-token
// rotation 의 reuse-grace 보다 짧게 잡으면 안전. 10s 면 새 쿠키가 jar 에 도착할 시간으로 충분.
const REFRESH_FRESH_WINDOW_MS = 10 * 1000;

const client: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

/**
 * 같은 origin 의 모든 탭/iframe 사이에서 refresh 호출을 단일화한다.
 *
 * 두 탭이 동시에 401 을 받으면 각자 `/api/auth/refresh` 를 호출해 user-service 의 refresh
 * rotation 에 reuse detection 이 걸려 강제 로그아웃되는 사례가 있었다. Web Locks API 로
 * 직렬화하고, 락을 늦게 잡은 탭은 localStorage marker 로 직전 refresh 시점을 확인해 중복
 * 호출을 skip 한다. 새 쿠키는 cookie jar 에 공유되므로 skip 한 탭도 곧장 원 요청을 재시도하면 된다.
 *
 * Web Locks 미지원 환경(매우 오래된 브라우저)에서는 같은 탭 내 single-flight 만 보장하고
 * 다중 탭 race 는 잔존 — admin-web 의 지원 브라우저 범위에서는 사실상 미지원 환경 없음.
 */
async function performRefresh(): Promise<void> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  try {
    localStorage.setItem(REFRESH_MARKER_KEY, String(Date.now()));
  } catch {
    // private 모드 등 storage write 실패는 무해 — 다음 탭이 한 번 더 refresh 할 뿐.
  }
}

function readRefreshMarker(): number {
  try {
    return Number(localStorage.getItem(REFRESH_MARKER_KEY)) || 0;
  } catch {
    return 0;
  }
}

// in-tab dedupe — Web Locks 미지원 환경에서만 의미가 있음. 지원 환경에선 navigator.locks 가 같은 탭의 두 번째 요청도 직렬화한다.
let inflight: Promise<void> | null = null;

async function refreshAccessToken(): Promise<void> {
  if (inflight) return inflight;

  const supportsLocks =
    typeof navigator !== 'undefined' && 'locks' in navigator;

  const run = async () => {
    if (supportsLocks) {
      await navigator.locks.request(REFRESH_LOCK_NAME, async () => {
        if (Date.now() - readRefreshMarker() < REFRESH_FRESH_WINDOW_MS) {
          return; // 다른 탭이 방금 갱신함 — 새 쿠키는 jar 에 이미 있음
        }
        await performRefresh();
      });
    } else {
      await performRefresh();
    }
  };

  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

interface RetryConfig extends AxiosRequestConfig {
  retry: number;
  retryDelay: number;
  _retry?: boolean;
}

const globalConfig = {
  retry: 2,
  retryDelay: 1000,
};

// Request interceptor: 전체 URL을 사용하는 경우 baseURL 무시 및 withCredentials 설정
client.interceptors.request.use((config) => {
  // URL이 http:// 또는 https://로 시작하면 baseURL을 무시
  if (
    config.url &&
    (config.url.startsWith('http://') || config.url.startsWith('https://'))
  ) {
    config.baseURL = '';
    // 외부 API 요청인 경우 withCredentials를 false로 설정 (CORS 이슈 방지)
    // 필요시 서버에서 특정 origin을 명시적으로 허용하도록 수정해야 함
    config.withCredentials = false;
  }
  return config;
});

// `{ success, data, message? }` envelope를 자동으로 unwrap 한다.
// 백엔드 중 user-service 만 ResponseInterceptor(@app/shared) 로 envelope 를 씌우고,
// core/ugc-service 등은 raw 응답을 그대로 반환한다.
// 도메인 client 가 양쪽을 신경 쓰지 않도록 여기서 한 번에 정규화한다.
function isApiEnvelope(
  body: unknown
): body is { success: boolean; data: unknown; message?: string } {
  if (!body || typeof body !== 'object') return false;
  const v = body as Record<string, unknown>;
  return v.success === true && 'data' in v;
}

client.interceptors.response.use(
  (response) => {
    if (isApiEnvelope(response.data)) {
      response.data = response.data.data;
    }
    return response;
  },
  async (err: AxiosError) => {
    const config = err.config as RetryConfig;

    // 401 에러 처리 (인증 만료) — Web Locks 로 다중 탭 single-flight 화
    if (err.response?.status === 401 && !config._retry) {
      config._retry = true;
      try {
        await refreshAccessToken();
        return client(config);
      } catch (refreshError) {
        // 세션 만료 이벤트 발행 (AuthExpiredHandler 가 SPA 내 리다이렉트 처리)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        console.error('Token refresh error:', refreshError);
        throw new CustomError({
          message: '인증이 만료되었습니다. 다시 로그인해주세요.',
          statusCode: 401,
        });
      }
    }

    // 4xx는 재시도 대상이 아니다 — 서버가 내려준 메시지를 그대로 보존해 던진다
    // (재시도 후 raw AxiosError를 던지면 토스트에 "Request failed with status code 409" 같은
    //  generic 문구만 떠서 운영자가 원인을 알 수 없다)
    if (err.response && err.response.status < 500) {
      const data = err.response.data as { message?: string | string[] };
      const message =
        (Array.isArray(data?.message)
          ? data.message.join('\n')
          : data?.message) ||
        err.message ||
        '요청 처리 중 오류가 발생했습니다.';

      throw new CustomError({
        message,
        statusCode: err.response.status,
        response: err.response.data,
      });
    }

    // 일반적인 재시도 로직
    if (!config) {
      const statusCode = err.response?.status || 500;
      const message =
        (err.response?.data as { message: string })?.message ||
        err.message ||
        '요청 처리 중 오류가 발생했습니다.';

      throw new CustomError({
        message,
        statusCode,
        response: err.response?.data,
      });
    }

    // 재시도 횟수를 설정 안하고 axios.get() 처럼 사용하는 경우 기본값 설정
    if (config.retry === undefined) {
      config.retry = globalConfig.retry;
      config.retryDelay = globalConfig.retryDelay;
    }

    // 재시도 횟수 체크 — 소진 시에도 서버 메시지를 보존해 던진다
    if (config.retry <= 0) {
      const data = err.response?.data as
        | { message?: string | string[] }
        | undefined;
      const message =
        (Array.isArray(data?.message)
          ? data.message.join('\n')
          : data?.message) ||
        err.message ||
        '요청 처리 중 오류가 발생했습니다.';

      throw new CustomError({
        message,
        statusCode: err.response?.status || 500,
        response: err.response?.data,
      });
    }

    // 재시도하기 전에 카운트 감소
    config.retry -= 1;

    const delayRetryRequest = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log('retry the request', config.url);
        resolve();
      }, config.retryDelay || 1000);
    });

    return delayRetryRequest.then(() => client(config));
  }
);

export { client, globalConfig };
