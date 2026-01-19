import { AxiosInstance, AxiosRequestConfig } from "axios";
export declare class HsFmsError extends Error {
    readonly error: {
        message: string;
        developerMessage: string;
    };
    constructor(error: {
        message: string;
        developerMessage: string;
    });
}
export interface HttpClientConfig {
    isTest: boolean;
    timeout?: number;
    swKey: string;
    custKey: string;
    baseURL?: string;
}
export declare class HttpClient {
    protected client: AxiosInstance;
    protected config: HttpClientConfig;
    getConfig(): HttpClientConfig;
    constructor(config: HttpClientConfig);
    private setupInterceptors;
    get<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
    post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
    put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
    delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
    request<T>(config: AxiosRequestConfig): Promise<T>;
}
