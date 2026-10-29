import { AxiosHeaders } from 'axios';
import {
  applyRevealHeader,
  endReveal,
  isRevealing,
  parsePiiHeaders,
  startReveal,
  subscribeReveal,
} from './pii-notices';

const headers = (values: Record<string, string>) => (name: string) => values[name];

describe('parsePiiHeaders', () => {
  it('parses pii headers into meta', () => {
    expect(
      parsePiiHeaders(
        headers({ 'x-pii-masked': 'name,phone', 'x-pii-mask-reason': 'no-permission', 'x-pii-redacted': 'deltas', 'x-pii-revealable': '1' }),
      ),
    ).toEqual({ maskedKinds: ['name', 'phone'], reason: 'no-permission', redactedPaths: ['deltas'], revealable: true });
  });

  it('treats a missing or none header as not masked', () => {
    expect(parsePiiHeaders(headers({}))).toBeNull();
    expect(parsePiiHeaders(headers({ 'x-pii-masked': 'none' }))).toBeNull();
  });
});

describe('reveal state', () => {
  beforeEach(() => {
    endReveal();
  });
  afterEach(() => {
    endReveal();
  });

  it('is on for the revealed screen only', () => {
    startReveal('/order/history/123');
    expect(isRevealing('/order/history/123')).toBe(true);
    expect(isRevealing('/order/history/456')).toBe(false);
    expect(isRevealing('/order/history')).toBe(false);
  });

  it('stays on across repeated checks and reports whether it was on when ended', () => {
    startReveal('/a');
    expect(isRevealing('/a')).toBe(true);
    expect(isRevealing('/a')).toBe(true);
    expect(endReveal()).toBe(true);
    expect(endReveal()).toBe(false);
    expect(isRevealing('/a')).toBe(false);
  });

  it('tells subscribers once per start and per end', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeReveal(listener);
    startReveal('/a');
    expect(listener).toHaveBeenCalledTimes(1);
    endReveal();
    expect(listener).toHaveBeenCalledTimes(2);
    endReveal();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    startReveal('/a');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('sets the header while revealing and strips a stale one afterwards', () => {
    startReveal('/a');
    const on = new AxiosHeaders();
    applyRevealHeader(on, '/a');
    expect(on.get('x-pii-reveal')).toBe('1');

    const retried = new AxiosHeaders({ 'x-pii-reveal': '1' });
    endReveal();
    applyRevealHeader(retried, '/a');
    expect(retried.has('x-pii-reveal')).toBe(false);

    startReveal('/a');
    const moved = new AxiosHeaders({ 'x-pii-reveal': '1' });
    applyRevealHeader(moved, '/b');
    expect(moved.has('x-pii-reveal')).toBe(false);
  });
});
