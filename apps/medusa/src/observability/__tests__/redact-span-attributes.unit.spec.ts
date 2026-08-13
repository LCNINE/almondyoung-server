import { redactSpanAttributes } from '../redact-span-attributes';

describe('redactSpanAttributes', () => {
  it('점이 없는 키(헤더 유래)를 삭제한다', () => {
    const result = redactSpanAttributes({
      authorization: 'Bearer eyJhbGciOi',
      cookie: 'session=abc',
      'accept-encoding': 'gzip',
      'x-publishable-api-key': 'pk_123',
    });
    expect(result).toEqual({});
  });

  it('점이 있는 semconv 속성은 통과시킨다', () => {
    const attributes = {
      'http.route': '/store/products',
      'http.method': 'GET',
      'db.system': 'postgresql',
      'workflow.step.idempotency_key': 'abc',
    };
    expect(redactSpanAttributes(attributes)).toEqual(attributes);
  });

  it('db.connection_string 의 비밀번호를 마스킹한다', () => {
    const result = redactSpanAttributes({
      'db.connection_string': 'postgresql://postgres:s3cr3t@localhost:5432/medusa',
    });
    expect(result).toEqual({
      'db.connection_string': 'postgresql://postgres:[REDACTED]@localhost:5432/medusa',
    });
  });

  it('헤더와 semconv 가 섞여 있으면 헤더만 걸러낸다', () => {
    const result = redactSpanAttributes({
      authorization: 'Bearer x',
      'http.route': '/admin/orders',
    });
    expect(result).toEqual({ 'http.route': '/admin/orders' });
  });

  it('db.connection_string 이 문자열이 아니면 그대로 둔다', () => {
    expect(redactSpanAttributes({ 'db.connection_string': 42 })).toEqual({
      'db.connection_string': 42,
    });
  });

  it('빈 객체를 처리한다', () => {
    expect(redactSpanAttributes({})).toEqual({});
  });

  it('입력 객체를 변형하지 않는다', () => {
    const input = { authorization: 'Bearer x', 'http.route': '/a' };
    redactSpanAttributes(input);
    expect(input).toEqual({ authorization: 'Bearer x', 'http.route': '/a' });
  });

  it('http.request.header.* semconv 를 삭제한다', () => {
    const result = redactSpanAttributes({
      'http.request.header.authorization': ['Bearer eyJhbGciOi'],
      'http.request.header.cookie': ['session=abc'],
      'http.route': '/store/products',
    });
    expect(result).toEqual({ 'http.route': '/store/products' });
  });

  it('http.response.header.* semconv 를 삭제한다', () => {
    const result = redactSpanAttributes({
      'http.response.header.set-cookie': ['sessionId=xyz'],
      'http.status_code': 200,
    });
    expect(result).toEqual({ 'http.status_code': 200 });
  });

  it('프리픽스 규칙이 http.route/http.method 는 통과시킨다', () => {
    const attributes = {
      'http.route': '/admin/orders',
      'http.method': 'POST',
      'http.request.header.authorization': ['Bearer x'],
    };
    const result = redactSpanAttributes(attributes);
    expect(result).toEqual({
      'http.route': '/admin/orders',
      'http.method': 'POST',
    });
  });
});
