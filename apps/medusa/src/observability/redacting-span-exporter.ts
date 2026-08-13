import { redactSpanAttributes } from './redact-span-attributes';

interface ExportResultLike {
  code: number;
  error?: Error;
}

/**
 * `@opentelemetry/sdk-trace-base` 의 SpanExporter 와 구조적으로 호환되는 최소 형태.
 * 타입을 직접 import 하지 않는 이유는 sdk-trace-base 가 apps/medusa 의 직접
 * 의존성이 아니기 때문이다 (transitive 의존에 기대면 hoisting 에 취약하다).
 */
export interface SpanExporterLike {
  export(spans: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

export class RedactingSpanExporter implements SpanExporterLike {
  constructor(private readonly inner: SpanExporterLike) {}

  export(spans: readonly unknown[], resultCallback: (result: ExportResultLike) => void): void {
    for (const span of spans) {
      const target = span as { attributes?: Record<string, unknown> };
      if (target.attributes) {
        // ReadableSpan.attributes 는 타입상 readonly 지만 런타임에는 평범한 객체다.
        // 내보내기 직전에 정리본으로 교체한다 — 이 시점 이후로 span 을 읽는 것은
        // exporter 뿐이므로 다른 소비자에 영향이 없다.
        target.attributes = redactSpanAttributes(target.attributes);
      }
    }

    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
