import { Reflector } from '@nestjs/core';
import { PiiExport, PiiResponse, PiiWrite, isPiiExport, piiResponseOf } from './pii-response.decorator';

describe('PiiResponse', () => {
  it('reads the spec back through the reflector', () => {
    class Controller {
      @PiiResponse({
        fields: { 'data[].customerName': 'name' },
        subjects: [{ path: 'data[].id', type: 'sales_order' }],
        reveal: false,
      })
      list() {}
    }
    const spec = piiResponseOf(new Reflector(), Controller.prototype.list);
    expect(spec?.fields).toEqual({ 'data[].customerName': 'name' });
    expect(spec?.subjects).toEqual([{ path: 'data[].id', type: 'sales_order' }]);
  });

  it('returns nothing for an undeclared handler', () => {
    class Controller {
      plain() {}
    }
    expect(piiResponseOf(new Reflector(), Controller.prototype.plain)).toBeUndefined();
  });

  it('rejects a malformed path when the decorator is applied', () => {
    expect(() => PiiResponse({ fields: { 'a..b': 'name' }, subjects: [{ path: 'id', type: 'user' }] })).toThrow(
      'Invalid PII path',
    );
    expect(() => PiiResponse({ fields: { a: 'name' }, subjects: [{ path: 'id[', type: 'user' }] })).toThrow(
      'Invalid PII path',
    );
  });

  it('accepts a route parameter as the subject', () => {
    expect(() => PiiResponse({ fields: { email: 'email' }, subjects: [{ param: 'userId', type: 'user' }] })).not.toThrow();
  });

  it('rejects a subject with neither a path nor a parameter', () => {
    expect(() => PiiResponse({ fields: { email: 'email' }, subjects: [{ type: 'user' }] })).toThrow('subject');
  });

  it('requires a subject path for every declaration', () => {
    expect(() => PiiResponse({ fields: { a: 'name' }, subjects: [] })).toThrow('subject');
  });

  it('requires at least one field', () => {
    expect(() => PiiResponse({ fields: {}, subjects: [{ path: 'id', type: 'user' }] })).toThrow('field');
  });

  it('rejects rawWithByField paths that are not declared fields', () => {
    expect(() =>
      PiiResponse({
        fields: { a: 'name' },
        subjects: [{ path: 'id', type: 'user' }],
        rawWithByField: { b: ['fulfillment.recipient.read'] },
      }),
    ).toThrow('rawWithByField');
  });
});

describe('PiiExport', () => {
  it('marks a handler as a personal data export', () => {
    class Controller {
      @PiiExport()
      download() {}
      plain() {}
    }
    expect(isPiiExport(new Reflector(), Controller.prototype.download)).toBe(true);
    expect(isPiiExport(new Reflector(), Controller.prototype.plain)).toBe(false);
  });

  it('accepts only plain dotted body paths for a write declaration', () => {
    expect(() => PiiWrite({ fields: ['items[].phone'] })).toThrow();
    expect(() => PiiWrite({ fields: ['*.phone'] })).toThrow();
    expect(() => PiiWrite({ fields: [] })).toThrow();
    expect(() => PiiWrite({ fields: ['customer.phone'] })).not.toThrow();
  });
});

