import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { RedactingLogExporter, type LogRecordExporterLike } from '../redacting-log-exporter';

/**
 * 이 스펙이 잡아야 하는 버그: `LogRecord.body` 는 프로토타입 접근자이고, 그 setter 는
 * `Logger.emit()` 이 `onEmit` 이후 곧바로 부르는 `_makeReadonly()` 뒤에는 조용히 no-op
 * 이 된다. exporter 는 항상 그 시점 *이후* 에 실행되므로, `target.body = ...` 같은 평범한
 * 대입은 버려진다. 이걸 잡으려면 평범한 객체가 아니라 실제 `BatchLogRecordProcessor` 를
 * 통과한(즉 readonly 가 된) `LogRecord` 를 exporter 에 흘려야 한다 — 그래서 실제
 * `@opentelemetry/sdk-logs`/`@opentelemetry/api-logs` 로 파이프라인을 조립한다.
 */

interface CapturedExport {
  body: unknown;
  attributes: Record<string, unknown> | undefined;
}

class CapturingExporter implements LogRecordExporterLike {
  captured: CapturedExport[] = [];

  export(logs: readonly unknown[], resultCallback: (result: { code: number }) => void): void {
    for (const log of logs) {
      const record = log as { body?: unknown; attributes?: Record<string, unknown> };
      this.captured.push({ body: record.body, attributes: record.attributes });
    }
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe('RedactingLogExporter (wrapper regression)', () => {
  it('실제 readonly LogRecord 를 통과시켜도 body 의 접속 문자열이 마스킹된다', async () => {
    const inner = new CapturingExporter();
    const processor = new BatchLogRecordProcessor(
      new RedactingLogExporter(inner) as unknown as ConstructorParameters<
        typeof BatchLogRecordProcessor
      >[0],
    );

    const provider = new LoggerProvider();
    provider.addLogRecordProcessor(processor);
    const logger = provider.getLogger('redacting-log-exporter.unit.spec');

    logger.emit({
      body: 'connect failed: postgresql://postgres:s3cr3t@localhost:5432/medusa',
      attributes: {
        'exception.message': 'postgresql://postgres:s3cr3t@localhost:5432/medusa 접속 실패',
      },
    });

    await provider.forceFlush();
    await provider.shutdown();

    expect(inner.captured).toHaveLength(1);
    const [exported] = inner.captured;

    expect(exported.body).toBe('connect failed: postgresql://postgres:[REDACTED]@localhost:5432/medusa');
    expect(String(exported.body)).not.toContain('s3cr3t');

    expect(exported.attributes?.['exception.message']).toBe(
      'postgresql://postgres:[REDACTED]@localhost:5432/medusa 접속 실패',
    );
    expect(JSON.stringify(exported.attributes)).not.toContain('s3cr3t');
  });
});
