'use client';

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { CustomError } from './customError';

const client: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// 토큰 갱신 관련 상태 관리
let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];

// 대기 중인 요청들에게 토큰 갱신 결과 알림
function onRefreshed(token: string | null) {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

// 토큰 갱신 대기 큐에 추가
function addRefreshSubscriber(callback: (token: string | null) => void) {
  refreshSubscribers.push(callback);
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();
    return data.data.accessToken;
  } catch (error) {
    console.error('Token refresh error:', error);

    throw new CustomError({
      message: '인증이 만료되었습니다. 다시 로그인해주세요.',
      statusCode: 401,
    });
  }
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

client.interceptors.response.use(
  (response) => response,
  async (err: AxiosError) => {
    const config = err.config as RetryConfig;

    // 401 에러 처리 (인증 만료)
    if (err.response?.status === 401 && !config._retry) {
      config._retry = true;

      // 이미 토큰 갱신 중인 경우
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          addRefreshSubscriber((token: string | null) => {
            if (token) {
              resolve(client(config));
            } else {
              reject(
                new CustomError({
                  message: '인증이 만료되었습니다. 다시 로그인해주세요.',
                  statusCode: 401,
                })
              );
            }
          });
        });
      }

      // 토큰 갱신 시작
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        onRefreshed(newToken);
        isRefreshing = false;

        return client(config); // newToken이 있으면 재시도
      } catch (refreshError) {
        onRefreshed(null);
        isRefreshing = false;

        // 세션 만료 이벤트 발행 (AuthExpiredHandler가 SPA 내 리다이렉트 처리)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }

        throw refreshError as CustomError;
      }
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

    // 재시도 횟수 체크
    if (config.retry <= 0) {
      return Promise.reject(err);
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
