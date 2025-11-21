// apps/notification/src/shared/utils/logger.utils.ts
import { Logger } from '@nestjs/common';

export interface LogContext {
    [key: string]: any;
}

export class StructuredLogger {
    constructor(private readonly logger: Logger) { }

    /**
     * Info 레벨 로그
     * log와 동일하게 동작하지만, 의미적으로 info 레벨임을 명시
     */
    info(message: string, context: LogContext = {}) {
        try {
            this.logger.log(message, JSON.stringify(context));
        } catch (error) {
            // JSON.stringify 실패 시 (순환 참조 등) fallback
            this.logger.log(message, String(context));
        }
    }

    log(message: string, context: LogContext = {}) {
        try {
            this.logger.log(message, JSON.stringify(context));
        } catch (error) {
            // JSON.stringify 실패 시 (순환 참조 등) fallback
            this.logger.log(message, String(context));
        }
    }

    error(message: string, context: LogContext = {}, trace?: string) {
        try {
            this.logger.error(message, trace, JSON.stringify(context));
        } catch (error) {
            // JSON.stringify 실패 시 (순환 참조 등) fallback
            this.logger.error(message, trace, String(context));
        }
    }

    warn(message: string, context: LogContext = {}) {
        try {
            this.logger.warn(message, JSON.stringify(context));
        } catch (error) {
            // JSON.stringify 실패 시 (순환 참조 등) fallback
            this.logger.warn(message, String(context));
        }
    }

    debug(message: string, context: LogContext = {}) {
        try {
            this.logger.debug(message, JSON.stringify(context));
        } catch (error) {
            // JSON.stringify 실패 시 (순환 참조 등) fallback
            this.logger.debug(message, String(context));
        }
    }
}