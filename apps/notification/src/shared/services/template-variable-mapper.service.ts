// apps/notification/src/shared/services/template-variable-mapper.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '../enums';

/**
 * 템플릿 변수 매핑 서비스
 * 
 * 각 채널별로 다른 템플릿 변수 전달 방식을 처리합니다:
 * - EMAIL (Resend): template.variables 형식
 * - KAKAO (NHN): templateParameter 형식 (#{key} -> {key: value})
 * - SMS, PUSH: body 내 {{variable}} 치환
 */
@Injectable()
export class TemplateVariableMapperService {
    private readonly logger = new Logger(TemplateVariableMapperService.name);

    /**
     * 템플릿에서 변수 추출
     * 템플릿 body에서 {{variable}} 또는 #{variable} 패턴을 찾아 변수 목록 반환
     */
    extractVariablesFromTemplate(templateBody: string): string[] {
        const variables: Set<string> = new Set();

        // {{variable}} 패턴 (Handlebars 스타일)
        const handlebarsPattern = /\{\{\s*([\w.]+)\s*\}\}/g;
        let match;
        while ((match = handlebarsPattern.exec(templateBody)) !== null) {
            variables.add(match[1]);
        }

        // #{variable} 패턴 (NHN 카카오톡 스타일)
        const nhnPattern = /#\{\s*([\w.]+)\s*\}/g;
        while ((match = nhnPattern.exec(templateBody)) !== null) {
            variables.add(match[1]);
        }

        return Array.from(variables);
    }

    /**
     * 채널별로 변수를 적절한 형식으로 변환
     */
    mapVariablesForChannel(
        channel: Channel,
        variables: Record<string, any>,
        template?: {
            kakaoTemplateCode?: string;
            providerTemplateId?: string;
        }
    ): {
        // 일반 텍스트 치환용 변수 (SMS, PUSH 등)
        interpolationVariables?: Record<string, any>;
        // NHN 카카오톡용 templateParameter
        kakaoTemplateParameters?: Record<string, string>;
        // Resend 이메일용 template variables
        resendTemplateVariables?: Record<string, string | number>;
        // Resend 템플릿 ID
        resendTemplateId?: string;
        // NHN 템플릿 코드
        kakaoTemplateCode?: string;
        // FCM data payload용 변수 (모두 문자열)
        fcmDataVariables?: Record<string, string>;
    } {
        const result: {
            interpolationVariables?: Record<string, any>;
            kakaoTemplateParameters?: Record<string, string>;
            resendTemplateVariables?: Record<string, string | number>;
            resendTemplateId?: string;
            kakaoTemplateCode?: string;
            fcmDataVariables?: Record<string, string>;
        } = {};

        switch (channel) {
            case 'KAKAO':
                // NHN 카카오톡은 templateParameter 형식 사용
                // 모든 값을 문자열로 변환 (NHN API 요구사항)
                const kakaoParams: Record<string, string> = {};
                for (const [key, value] of Object.entries(variables)) {
                    if (value !== undefined && value !== null) {
                        kakaoParams[key] = String(value);
                    }
                }
                result.kakaoTemplateParameters = kakaoParams;
                result.kakaoTemplateCode = template?.kakaoTemplateCode;
                break;

            case 'EMAIL':
                // Resend는 template.variables 형식 사용
                // 문자열 또는 숫자만 허용 (문서 참조)
                const resendVars: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(variables)) {
                    if (value !== undefined && value !== null) {
                        if (typeof value === 'string' || typeof value === 'number') {
                            // 문자열은 최대 50자 제한
                            if (typeof value === 'string' && value.length > 50) {
                                this.logger.warn(`Variable ${key} exceeds 50 characters, truncating`);
                                resendVars[key] = value.substring(0, 50);
                            } else {
                                resendVars[key] = value;
                            }
                        } else {
                            // 객체나 배열은 JSON 문자열로 변환
                            resendVars[key] = JSON.stringify(value).substring(0, 50);
                        }
                    }
                }
                result.resendTemplateVariables = resendVars;
                // Resend 템플릿 ID는 metadata에서 가져올 수 있음
                result.resendTemplateId = template?.providerTemplateId;
                break;

            case 'SMS':
                // Twilio SMS는 일반 텍스트 치환 사용
                // (Twilio Verify 템플릿은 별도 서비스이므로 여기서는 일반 SMS만 처리)
                result.interpolationVariables = variables;
                break;

            case 'PUSH':
                // FCM은 일반 텍스트 치환 사용
                // notification.title, notification.body에 변수 치환된 값 전달
                // data payload에는 변수 정보를 문자열로 포함 가능
                result.interpolationVariables = variables;
                // FCM data payload용 변수도 준비 (모두 문자열로 변환)
                const fcmDataVariables: Record<string, string> = {};
                for (const [key, value] of Object.entries(variables)) {
                    if (value !== undefined && value !== null) {
                        fcmDataVariables[key] = String(value);
                    }
                }
                result.fcmDataVariables = fcmDataVariables;
                break;

            default:
                // 기타 채널은 일반 텍스트 치환 사용
                result.interpolationVariables = variables;
                break;
        }

        return result;
    }

    /**
     * 이벤트 payload에서 템플릿 변수 추출
     * variablesSchema를 기반으로 payload에서 필요한 변수만 추출
     */
    extractVariablesFromPayload(
        payload: Record<string, any>,
        variablesSchema?: Record<string, {
            type: 'string' | 'number' | 'boolean' | 'object' | 'array';
            required?: boolean;
            description?: string;
        }>
    ): Record<string, any> {
        if (!variablesSchema) {
            // 스키마가 없으면 payload 전체를 변수로 사용
            return payload;
        }

        const extracted: Record<string, any> = {};

        for (const [key, schema] of Object.entries(variablesSchema)) {
            const value = this.resolvePath(payload, key);

            if (value === undefined || value === null) {
                if (schema.required) {
                    this.logger.warn(`Required variable ${key} is missing in payload`);
                }
                continue;
            }

            // 타입 검증
            if (this.validateType(value, schema.type)) {
                extracted[key] = value;
            } else {
                this.logger.warn(`Variable ${key} type mismatch. Expected ${schema.type}, got ${typeof value}`);
            }
        }

        return extracted;
    }

    /**
     * 객체 경로 해석 (예: "user.name" -> obj.user.name)
     */
    private resolvePath(obj: any, path: string): any {
        return path.split('.').reduce((acc, part) => {
            if (acc && typeof acc === 'object' && part in acc) {
                return acc[part];
            }
            return undefined;
        }, obj);
    }

    /**
     * 타입 검증
     */
    private validateType(value: any, expectedType: string): boolean {
        switch (expectedType) {
            case 'string':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number';
            case 'boolean':
                return typeof value === 'boolean';
            case 'object':
                return typeof value === 'object' && !Array.isArray(value) && value !== null;
            case 'array':
                return Array.isArray(value);
            default:
                return true; // 알 수 없는 타입은 통과
        }
    }
}

