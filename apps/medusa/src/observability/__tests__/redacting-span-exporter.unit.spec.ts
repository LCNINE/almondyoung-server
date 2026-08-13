import { RedactingSpanExporter, type SpanExporterLike } from '../redacting-span-exporter';

/**
 * span 경로는 (redacting-log-exporter 와 달리) readonly 트랩이 없다 — `ReadableSpan.attributes`
 * 는 타입상 readonly 지만 런타임에는 평범한 객체 필드다 (`redacting-span-exporter.ts` 주석 참고).
 * 그래서 여기서는 실제 `@opentelemetry/sdk-trace-base` 대신, 그 형태를 흉내낸 최소 객체로
 * 충분하다 — `apps/medusa` 는 그 패키지를 직접 의존하지 않으므로(설계 문서: hoisting 에 취약)
 * 테스트에서도 끌어오지 않는다. 이 스펙의 목적은 회귀 방지이지, exporter 배선 자체의
 * 신뢰성 검증(그건 span 경로가 이미 살아있다고 알려진 부분)이 아니다.
 */

interface CapturedExport {
  attributes: Record<string, unknown> | undefined;
}

class CapturingExporter implements SpanExporterLike {
  captured: CapturedExport[] = [];

  export(spans: readonly unknown[], resultCallback: (result: { code: number }) => void): void {
    for (const span of spans) {
      const s = span as { attributes?: Record<string, unknown> };
      this.captured.push({ attributes: s.attributes });
    }
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe('RedactingSpanExporter (wrapper regression)', () => {
  it('authorization 속성은 사라지고 http.route 는 살아남는다', () => {
    const inner = new CapturingExporter();
    const exporter = new RedactingSpanExporter(inner);

    const span = {
      name: 'GET /store/customers/me',
      attributes: {
        authorization: 'Bearer eyJhbGciOi',
        cookie: 'session=abc',
        'http.route': '/store/customers/me',
        'http.method': 'GET',
      },
    };

    exporter.export([span], () => {});

    expect(inner.captured).toHaveLength(1);
    const [exported] = inner.captured;

    expect(exported.attributes).not.toHaveProperty('authorization');
    expect(exported.attributes).not.toHaveProperty('cookie');
    expect(exported.attributes?.['http.route']).toBe('/store/customers/me');
    expect(exported.attributes?.['http.method']).toBe('GET');
  });
});
