import { BadRequestException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { lastValueFrom, of } from 'rxjs';
import { PiiExport, PiiResponse } from '../decorators/pii-response.decorator';
import { PiiAccessRecord, PiiAccessRecorder } from '../services/pii-access-recorder';
import { PiiMaskingInterceptor, PiiMaskingOptions } from './pii-masking.interceptor';

class Probe {
  @PiiResponse({
    fields: { customerName: 'name', 'shippingAddress.phone': 'phone', deltas: 'redact' },
    subjects: [{ path: 'id', type: 'sales_order' }],
    reveal: true,
  })
  detail(): void {}

  @PiiResponse({ fields: { 'data[].customerName': 'name' }, subjects: [{ path: 'data[].id', type: 'sales_order' }] })
  list(): void {}

  @PiiResponse({
    fields: { 'recipient.name': 'name', 'recipient.phone': 'phone', ordererEmail: 'email' },
    subjects: [{ path: 'id', type: 'shipment' }],
    rawWithByField: {
      'recipient.name': ['customer.pii.read', 'fulfillment.recipient.read'],
      'recipient.phone': ['customer.pii.read', 'fulfillment.recipient.read'],
    },
  })
  shipment(): void {}

  @PiiExport()
  @PiiResponse({ fields: { '[].email': 'email' }, subjects: [{ path: '[].id', type: 'user' }] })
  exportUsers(): void {}

  @PiiResponse({ fields: { email: 'email' }, subjects: [{ param: 'userId', type: 'user' }] })
  profile(): void {}

  @PiiResponse({
    fields: { 'items[].phone': 'phone' },
    subjects: [
      { path: 'items[].userId', type: 'user' },
      { path: 'items[].phone', type: 'sms_conversation', hash: true },
    ],
  })
  conversations(): void {}

  plain(): void {}
}

const detailBody = () => ({
  id: 'so-1',
  customerName: '홍길동',
  shippingAddress: { phone: '010-1234-5678', city: '서울' },
  deltas: [{ before: { road: '중대로' } }],
  total: 1000,
});

class FakeRecorder extends PiiAccessRecorder {
  readonly records: PiiAccessRecord[] = [];
  fail = false;
  async record(entry: PiiAccessRecord): Promise<void> {
    if (this.fail) throw new Error('down');
    this.records.push(entry);
  }
}

interface Setup {
  permissions?: readonly string[] | null;
  revealRequired?: boolean;
  envelope?: PiiMaskingOptions['envelope'];
}

function setup({ permissions = ['customer.pii.read'], revealRequired = false, envelope = 'none' }: Setup = {}) {
  const recorder = new FakeRecorder();
  const cache = { permissionsFor: jest.fn(() => (permissions === null ? null : new Set(permissions))) };
  const options: PiiMaskingOptions = { service: 'core', revealRequired, envelope };
  const interceptor = new PiiMaskingInterceptor(new Reflector(), cache, recorder, options);
  return { interceptor, recorder, cache };
}

interface Call {
  handler: keyof Probe;
  body: unknown;
  user?: { id?: string; userId?: string; sub?: string; login_id?: string; roles: string[] } | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  params?: Record<string, string>;
}

async function call(interceptor: PiiMaskingInterceptor, c: Call) {
  const request = {
    user: c.user === undefined ? { id: 'staff-1', login_id: 'kim', roles: ['admin'] } : c.user ?? undefined,
    headers: { 'user-agent': 'jest', 'x-request-id': 'req-1', ...(c.headers ?? {}) },
    query: c.query ?? {},
    params: c.params ?? {},
    method: 'GET',
    ip: '10.0.0.5',
    route: { path: '/sales-orders/:id' },
  };
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  const context = new ExecutionContextHost([request, response], Probe, Probe.prototype[c.handler]);
  context.setType('http');
  const body = await lastValueFrom(interceptor.intercept(context, { handle: () => of(c.body) }));
  return { body, headers: response.getHeaders() };
}

describe('PiiMaskingInterceptor', () => {
  it('passes undeclared routes through untouched', async () => {
    const { interceptor, recorder } = setup({ permissions: [] });
    const input = detailBody();
    const out = await call(interceptor, { handler: 'plain', body: input });
    expect(out.body).toBe(input);
    expect(out.headers['x-pii-masked']).toBeUndefined();
    expect(recorder.records).toHaveLength(0);
  });

  it('returns the identical object to a viewer with permission and records once', async () => {
    const { interceptor, recorder } = setup();
    const input = detailBody();
    const out = await call(interceptor, { handler: 'detail', body: input });
    expect(out.body).toBe(input);
    expect(out.headers['x-pii-masked']).toBe('none');
    expect(recorder.records).toHaveLength(1);
    expect(recorder.records[0]).toMatchObject({
      actorUserId: 'staff-1',
      actorLoginId: 'kim',
      sourceService: 'core',
      method: 'GET',
      route: '/sales-orders/:id',
      action: 'view',
      subjects: [{ type: 'sales_order', id: 'so-1' }],
      subjectCount: 1,
      peerIp: '10.0.0.5',
      userAgent: 'jest',
      requestId: 'req-1',
      reason: null,
    });
    expect([...recorder.records[0].kinds].sort()).toEqual(['name', 'phone', 'redact']);
  });

  it('masks declared fields for a viewer without permission and sets headers', async () => {
    const { interceptor, recorder } = setup({ permissions: ['order.order.read'] });
    const input = detailBody();
    const out = await call(interceptor, { handler: 'detail', body: input });
    expect(out.body).toEqual({
      id: 'so-1',
      customerName: '홍*동',
      shippingAddress: { phone: '010-****-5678', city: '서울' },
      deltas: null,
      total: 1000,
    });
    expect(input.customerName).toBe('홍길동');
    expect(String(out.headers['x-pii-masked']).split(',').sort()).toEqual(['name', 'phone', 'redact']);
    expect(out.headers['x-pii-mask-reason']).toBe('no-permission');
    expect(out.headers['x-pii-redacted']).toBe('deltas');
    expect(out.headers['x-pii-revealable']).toBeUndefined();
    expect(recorder.records).toHaveLength(0);
  });

  it('reads the user id the shared token strategy sets (userId and sub, no id)', async () => {
    const { interceptor, recorder } = setup();
    const input = detailBody();
    const out = await call(interceptor, { handler: 'detail', body: input, user: { userId: 'staff-9', sub: 'staff-9', roles: ['admin'] } });
    expect(out.body).toBe(input);
    expect(recorder.records[0].actorUserId).toBe('staff-9');
  });

  it('masks for a request without a user and does not record', async () => {
    const { interceptor, recorder } = setup();
    const out = await call(interceptor, { handler: 'detail', body: detailBody(), user: null });
    expect(out.body).toMatchObject({ customerName: '홍*동' });
    expect(out.headers['x-pii-mask-reason']).toBe('no-permission');
    expect(recorder.records).toHaveLength(0);
  });

  it('masks with reason unavailable when the permission snapshot is missing', async () => {
    const { interceptor, recorder } = setup({ permissions: null });
    const out = await call(interceptor, { handler: 'detail', body: detailBody() });
    expect(out.body).toMatchObject({ customerName: '홍*동' });
    expect(out.headers['x-pii-mask-reason']).toBe('unavailable');
    expect(recorder.records).toHaveLength(0);
  });

  it('opens recipient fields with the recipient permission only', async () => {
    const { interceptor, recorder } = setup({ permissions: ['fulfillment.recipient.read'] });
    const out = await call(interceptor, {
      handler: 'shipment',
      body: { id: 'sh-1', recipient: { name: '홍길동', phone: '010-1234-5678' }, ordererEmail: 'abcd@x.com' },
    });
    expect(out.body).toEqual({ id: 'sh-1', recipient: { name: '홍길동', phone: '010-1234-5678' }, ordererEmail: 'ab***@x.com' });
    expect(out.headers['x-pii-masked']).toBe('email');
    expect(recorder.records).toHaveLength(1);
    expect([...recorder.records[0].kinds].sort()).toEqual(['name', 'phone']);
  });

  it('masks holders when reveal is required and marks the response revealable', async () => {
    const { interceptor, recorder } = setup({ revealRequired: true });
    const out = await call(interceptor, { handler: 'detail', body: detailBody() });
    expect(out.body).toMatchObject({ customerName: '홍*동' });
    expect(out.headers['x-pii-mask-reason']).toBe('reveal-required');
    expect(out.headers['x-pii-revealable']).toBe('1');
    expect(recorder.records).toHaveLength(0);
  });

  it('opens holders on an explicit reveal of a revealable route and records a reveal', async () => {
    const { interceptor, recorder } = setup({ revealRequired: true });
    const input = detailBody();
    const out = await call(interceptor, { handler: 'detail', body: input, headers: { 'x-pii-reveal': '1' } });
    expect(out.body).toBe(input);
    expect(recorder.records[0].action).toBe('reveal');
  });

  it('ignores a reveal header on a non-revealable route', async () => {
    const { interceptor } = setup({ revealRequired: true });
    const out = await call(interceptor, {
      handler: 'list',
      body: { data: [{ id: 'a', customerName: '홍길동' }] },
      headers: { 'x-pii-reveal': '1' },
    });
    expect(out.body).toEqual({ data: [{ id: 'a', customerName: '홍*동' }] });
  });

  it('ignores a reveal request from a viewer without permission', async () => {
    const { interceptor, recorder } = setup({ permissions: ['order.order.read'], revealRequired: true });
    const out = await call(interceptor, { handler: 'detail', body: detailBody(), headers: { 'x-pii-reveal': '1' } });
    expect(out.body).toMatchObject({ customerName: '홍*동' });
    expect(out.headers['x-pii-mask-reason']).toBe('no-permission');
    expect(recorder.records).toHaveLength(0);
  });

  it('keeps recipient fields open in reveal-required mode for the recipient permission', async () => {
    const { interceptor } = setup({ permissions: ['fulfillment.recipient.read'], revealRequired: true });
    const out = await call(interceptor, {
      handler: 'shipment',
      body: { id: 'sh-1', recipient: { name: '홍길동', phone: '010-1234-5678' }, ordererEmail: null },
    });
    expect(out.body).toEqual({ id: 'sh-1', recipient: { name: '홍길동', phone: '010-1234-5678' }, ordererEmail: null });
  });

  it('records every subject id of a list response up to the cap with the true count', async () => {
    const { interceptor, recorder } = setup();
    const data = Array.from({ length: 1500 }, (_, i) => ({ id: `so-${i}`, customerName: '홍길동' }));
    data.push({ id: 'so-0', customerName: '중복' });
    await call(interceptor, { handler: 'list', body: { data } });
    expect(recorder.records[0].subjects).toHaveLength(1000);
    expect(recorder.records[0].subjectCount).toBe(1500);
  });

  it('does not record when every declared value is empty', async () => {
    const { interceptor, recorder } = setup();
    const out = await call(interceptor, { handler: 'list', body: { data: [{ id: 'a', customerName: null }] } });
    expect(out.headers['x-pii-masked']).toBe('none');
    expect(recorder.records).toHaveLength(0);
  });

  it('masks when recording fails', async () => {
    const { interceptor, recorder } = setup();
    recorder.fail = true;
    const out = await call(interceptor, { handler: 'detail', body: detailBody() });
    expect(out.body).toMatchObject({ customerName: '홍*동', deltas: null });
    expect(out.headers['x-pii-mask-reason']).toBe('record-failed');
  });

  it('stores query keys without values', async () => {
    const { interceptor, recorder } = setup();
    await call(interceptor, { handler: 'detail', body: detailBody(), query: { phone: '01012345678', limit: '20' } });
    expect([...recorder.records[0].queryKeys].sort()).toEqual(['limit', 'phone']);
    expect(JSON.stringify(recorder.records[0])).not.toContain('01012345678');
  });

  it('never puts personal values into the record', async () => {
    const { interceptor, recorder } = setup();
    await call(interceptor, { handler: 'detail', body: detailBody() });
    const text = JSON.stringify(recorder.records[0]);
    expect(text).not.toContain('홍길동');
    expect(text).not.toContain('5678');
  });

  it('requires an export reason only when raw data leaves', async () => {
    const { interceptor } = setup();
    await expect(call(interceptor, { handler: 'exportUsers', body: [{ id: 'u1', email: 'abcd@x.com' }] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const masked = setup({ permissions: [] });
    const out = await call(masked.interceptor, { handler: 'exportUsers', body: [{ id: 'u1', email: 'abcd@x.com' }] });
    expect(out.body).toEqual([{ id: 'u1', email: 'ab***@x.com' }]);
  });

  it('records an export with its reason', async () => {
    const { interceptor, recorder } = setup();
    await call(interceptor, {
      handler: 'exportUsers',
      body: [{ id: 'u1', email: 'abcd@x.com' }],
      headers: { 'x-pii-export-reason': encodeURIComponent('월말 정산 대조') },
    });
    expect(recorder.records[0]).toMatchObject({ action: 'export', reason: '월말 정산 대조' });
  });

  it('takes the subject from a route parameter', async () => {
    const { interceptor, recorder } = setup();
    await call(interceptor, { handler: 'profile', body: { email: 'abcd@x.com' }, params: { userId: 'u-7' } });
    expect(recorder.records[0].subjects).toEqual([{ type: 'user', id: 'u-7' }]);
  });

  it('records a hashed identifier instead of the value for a hashed subject', async () => {
    const { interceptor, recorder } = setup();
    await call(interceptor, { handler: 'conversations', body: { items: [{ userId: null, phone: '01012345678' }] } });
    const [subject] = recorder.records[0].subjects;
    expect(subject.type).toBe('sms_conversation');
    expect(subject.id).toMatch(/^h:[0-9a-f]{16}$/);
    expect(JSON.stringify(recorder.records[0])).not.toContain('01012345678');
  });

  it('warns when raw values leave without any subject identifier', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { interceptor } = setup();
    await call(interceptor, { handler: 'profile', body: { email: 'abcd@x.com' } });
    expect(warn.mock.calls.some(([m]) => String(m).includes('pii_access_without_subject'))).toBe(true);
    warn.mockRestore();
  });

  it('unwraps the success-data envelope before applying paths', async () => {
    const { interceptor } = setup({ permissions: [], envelope: 'success-data' });
    const out = await call(interceptor, {
      handler: 'list',
      body: { success: true, data: { data: [{ id: 'a', customerName: '홍길동' }] } },
    });
    expect(out.body).toEqual({ success: true, data: { data: [{ id: 'a', customerName: '홍*동' }] } });
  });
});
