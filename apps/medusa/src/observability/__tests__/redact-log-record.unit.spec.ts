import { redactLogRecordFields } from '../redact-log-record';

describe('redactLogRecordFields', () => {
  it('body 문자열 안의 접속 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'connect failed: postgresql://postgres:s3cr3t@localhost:5432/medusa',
      attributes: {},
    });
    expect(result.body).toBe('connect failed: postgresql://postgres:[REDACTED]@localhost:5432/medusa');
  });

  it('문자열 attribute 를 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'error',
      attributes: {
        'exception.message': 'postgresql://postgres:s3cr3t@localhost:5432/medusa 접속 실패',
        'exception.type': 'Error',
      },
    });
    expect(result.attributes).toEqual({
      'exception.message': 'postgresql://postgres:[REDACTED]@localhost:5432/medusa 접속 실패',
      'exception.type': 'Error',
    });
  });

  it('점 없는 키를 삭제하지 않는다 — 로그에는 헤더 스프레드가 없다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { level: 'info', count: 3 },
    });
    expect(result.attributes).toEqual({ level: 'info', count: 3 });
  });

  it('문자열이 아닌 attribute 는 그대로 둔다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { count: 42, enabled: true, missing: null },
    });
    expect(result.attributes).toEqual({ count: 42, enabled: true, missing: null });
  });

  it('문자열이 아닌 body 는 그대로 둔다', () => {
    const result = redactLogRecordFields({ body: { code: 500 }, attributes: {} });
    expect(result.body).toEqual({ code: 500 });
  });

  it('body 와 attributes 가 없어도 처리한다', () => {
    const result = redactLogRecordFields({});
    expect(result.body).toBeUndefined();
    expect(result.attributes).toEqual({});
  });

  it('입력 객체를 변형하지 않는다', () => {
    const input = {
      body: 'postgresql://u:pw@localhost:5432/d',
      attributes: { 'exception.message': 'postgresql://u:pw@localhost:5432/d' },
    };
    redactLogRecordFields(input);
    expect(input.body).toBe('postgresql://u:pw@localhost:5432/d');
    expect(input.attributes['exception.message']).toBe('postgresql://u:pw@localhost:5432/d');
  });

  it('배열 안의 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: ['at foo (postgresql://postgres:s3cr3t@localhost:5432/medusa)', 'at bar'],
      attributes: {},
    });
    expect(result.body).toEqual([
      'at foo (postgresql://postgres:[REDACTED]@localhost:5432/medusa)',
      'at bar',
    ]);
  });

  it('중첩 객체 안의 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: {
        'db.error.detail': {
          dsn: 'postgresql://postgres:s3cr3t@localhost:5432/medusa',
          code: 'CONNECTION_FAILED',
        },
      },
    });
    expect(result.attributes['db.error.detail']).toEqual({
      dsn: 'postgresql://postgres:[REDACTED]@localhost:5432/medusa',
      code: 'CONNECTION_FAILED',
    });
  });

  it('중첩 배열·객체 혼합에서 문자열을 스크럽한다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: {
        traces: [
          { message: 'postgresql://postgres:s3cr3t@localhost:5432/medusa 접속 실패' },
          { message: 'retry 성공' },
        ],
      },
    });
    expect(result.attributes.traces).toEqual([
      { message: 'postgresql://postgres:[REDACTED]@localhost:5432/medusa 접속 실패' },
      { message: 'retry 성공' },
    ]);
  });

  it('깊이 제한 초과 시 플레이스홀더를 반환하고 평문을 유출하지 않는다', () => {
    // 깊이 9의 중첩 구조 생성 (MAX_REDACTION_DEPTH = 8 을 넘음)
    let deepNested: any = { dsn: 'postgresql://postgres:s3cr3t@localhost:5432/medusa' };
    for (let i = 0; i < 9; i++) {
      deepNested = { nested: deepNested };
    }

    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { data: deepNested },
    });

    // 깊이 제한 초과 시 플레이스홀더가 깊은 곳에 있음
    // 8 단계 중첩 까지는 구조가 유지되고, 9단계에서 플레이스홀더로 대체됨
    const stringified = JSON.stringify(result);
    expect(stringified).toContain('[Depth limit exceeded]');
    // 평문 비밀번호가 결과에 없는지 확인 — 깊이 초과로 스크럽 안 된 dsn 도 없음
    expect(stringified).not.toContain('s3cr3t');
  });

  it('순환 참조는 플레이스홀더로 표현하고 평문을 유출하지 않는다', () => {
    const circular: any = { name: 'error', dsn: 'postgresql://postgres:s3cr3t@localhost:5432/medusa' };
    circular.self = circular; // 자기 자신 참조

    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { error: circular },
    });

    // 순환 참조는 플레이스홀더로 표현됨
    expect((result.attributes.error as any).self).toBe('[Circular]');
    // 첫 참조의 dsn 은 스크럽됨
    expect((result.attributes.error as any).dsn).toBe('postgresql://postgres:[REDACTED]@localhost:5432/medusa');
    // 평문 비밀번호가 결과에 없는지 확인
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
  });

  it('비문자열 스칼라(number, boolean, null)는 여전히 그대로다', () => {
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: {
        nested: {
          count: 42,
          enabled: true,
          missing: null,
          undef: undefined,
        },
      },
    });
    expect(result.attributes.nested).toEqual({
      count: 42,
      enabled: true,
      missing: null,
      undef: undefined,
    });
  });

  it('입력 불변성이 중첩 구조에서도 유지된다', () => {
    const input = {
      body: ['postgresql://u:pw@localhost/d'],
      attributes: {
        nested: {
          dsn: 'postgresql://u:pw@localhost/d',
        },
      },
    };

    redactLogRecordFields(input);

    // 원본 배열과 객체는 스크럽되지 않은 채로 유지된다
    expect((input.body as any)[0]).toBe('postgresql://u:pw@localhost/d');
    expect(input.attributes.nested['dsn']).toBe('postgresql://u:pw@localhost/d');
  });

  it('Error 인스턴스가 attribute 로 오면 {} 로 바뀌지 않고 보존된다', () => {
    const error = new Error('test error');
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { 'exception.error': error },
    });

    // Error 인스턴스가 그대로 보존됨 (Object.entries 로 재귀하면 {} 가 됨)
    expect(result.attributes['exception.error']).toBe(error);
    expect(result.attributes['exception.error']).toBeInstanceOf(Error);
  });

  it('Date 인스턴스가 attribute 로 오면 보존된다', () => {
    const date = new Date('2026-08-14T10:00:00Z');
    const result = redactLogRecordFields({
      body: 'ok',
      attributes: { timestamp: date },
    });

    // Date 인스턴스가 그대로 보존됨
    expect(result.attributes.timestamp).toBe(date);
    expect(result.attributes.timestamp).toBeInstanceOf(Date);
  });
});
