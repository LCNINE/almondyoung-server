import { HmsAPI } from "../index";
import { MockHmsAPI } from "./MockHmsAPI";
export interface ApiClientConfig {
    swKey: string;
    custKey: string;
    isTest?: boolean;
    timeout?: number;
    useMock?: boolean;
    mockServerUrl?: string;
}
/**
 * 환경에 따라 실제 API 또는 목업 API를 제공하는 팩토리 클래스
 */
export declare class ApiClientFactory {
    /**
     * 설정에 따라 적절한 API 클라이언트를 생성합니다.
     *
     * @param config API 클라이언트 설정
     * @returns HmsAPI 또는 MockHmsAPI 인스턴스
     */
    static create(config: ApiClientConfig): HmsAPI | MockHmsAPI;
    /**
     * 환경 변수만으로 API 클라이언트를 생성합니다.
     *
     * @returns HmsAPI 또는 MockHmsAPI 인스턴스
     */
    static createFromEnv(): HmsAPI | MockHmsAPI;
}
