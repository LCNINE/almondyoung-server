import { redactLogRecordFields } from './redact-log-record';

interface ExportResultLike {
  code: number;
  error?: Error;
}

/**
 * `@opentelemetry/sdk-logs` 의 LogRecordExporter 와 구조적으로 호환되는 최소 형태.
 */
export interface LogRecordExporterLike {
  export(logs: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void;
  shutdown(): Promise<void>;
}

export class RedactingLogExporter implements LogRecordExporterLike {
  constructor(private readonly inner: LogRecordExporterLike) {}

  export(logs: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void {
    for (const log of logs) {
      const source = log as { body?: unknown; attributes?: Record<string, unknown> };
      const { body, attributes } = redactLogRecordFields(source);

      // LogRecord.body 는 프로토타입 접근자이고, setter 는 Logger.emit() 이 _makeReadonly() 를
      // 부른 뒤 조용히 no-op 이 된다. exporter 시점에는 이미 readonly 이므로 평범한 대입은
      // redaction 을 버린다. own data property 를 만들어 접근자를 가린다.
      Object.defineProperty(log as object, 'body', {
        value: body,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      source.attributes = attributes;
    }

    this.inner.export(logs, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
