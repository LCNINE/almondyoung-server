import 'server-only';

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { cookies } from 'next/headers';
import { CustomError } from './customError';

const server: AxiosInstance = axios.create({
  baseURL: '/',
  headers: {
    'Content-Type': 'application/json',
  },
});

interface RetryConfig extends AxiosRequestConfig {
  retry: number;
  retryDelay: number;
  _retry?: boolean;
}

const globalServerConfig = {
  retry: 2,
  retryDelay: 1000,
};

server.interceptors.request.use(async (config) => {
  const cookieStore = await cookies();
  const cookieString = cookieStore.toString();

  config.headers = {
    ...(config.headers || {}),
    Cookie: cookieStore.toString(),
  } as any;

  return config;
});

server.interceptors.response.use(
  (response) => response,
  async (err: AxiosError) => {
    const config = err.config as RetryConfig;

    // 401 에러 처리 - 인증이 필요한 API 호출에서만 CustomError 발생
    if (err.response?.status === 401) {
      // 로그인 관련 API가 아닌 경우에만 CustomError 발생
      const isAuthEndpoint = config.url?.includes('/auth/');
      if (!isAuthEndpoint) {
        throw new CustomError({
          message: '인증이 만료되었습니다. 다시 로그인해주세요.',
          statusCode: 401,
          response: err.response?.data,
        });
      }
    }

    // 일반 재시도 로직
    if (!config) {
      const statusCode = err.response?.status || 500;
      const message =
        (err.response?.data as any)?.message ||
        err.message ||
        '요청 처리 중 오류가 발생했습니다.';

      throw new CustomError({
        message,
        statusCode,
        response: err.response?.data,
      });
    }

    if (config.retry === undefined) {
      config.retry = globalServerConfig.retry;
      config.retryDelay = globalServerConfig.retryDelay;
    }

    if (config.retry <= 0) return Promise.reject(err);

    config.retry -= 1;
    const delayRetryRequest = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log('[SERVER] retry request →', config.url);
        resolve();
      }, config.retryDelay || 1000);
    });

    return delayRetryRequest.then(() => server(config));
  }
);

export { server, globalServerConfig };
