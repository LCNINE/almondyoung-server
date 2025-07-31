// apps/notification/src/shared/utils/logger.utils.ts
import { Logger } from '@nestjs/common';

export interface LogContext {
    [key: string]: any;
}

export class StructuredLogger {
    constructor(private readonly logger: Logger) { }

    log(message: string, context: LogContext) {
        this.logger.log(message, JSON.stringify(context));
    }

    error(message: string, context: LogContext, trace?: string) {
        this.logger.error(message, trace, JSON.stringify(context));
    }

    warn(message: string, context: LogContext) {
        this.logger.warn(message, JSON.stringify(context));
    }

    debug(message: string, context: LogContext) {
        this.logger.debug(message, JSON.stringify(context));
    }
}