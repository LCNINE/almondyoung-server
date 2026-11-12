/**
 * @jest-environment jsdom
 */
import {
  forgetPending,
  pendingRequests,
  rememberPending,
} from './shipment-action-pending';

beforeEach(() => window.localStorage.clear());

const request = (
  shipmentId: string,
  idempotencyKey: string,
  sentAt = Date.now()
) => ({
  shipmentId,
  action: 'split' as const,
  idempotencyKey,
  sentAt,
});

it('remembers only the box, action, key and time — never what was typed', () => {
  rememberPending(request('s-1', 'k-1'));

  expect(pendingRequests()).toEqual([
    request('s-1', 'k-1', expect.any(Number)),
  ]);
  expect(
    Object.keys(
      JSON.parse(
        window.localStorage.getItem('almond.shipment-action-pending.v1:k-1') ??
          '{}'
      )
    ).sort()
  ).toEqual(['action', 'idempotencyKey', 'sentAt', 'shipmentId']);
});

it('keeps the first send time when the same request is sent again', () => {
  const first = Date.now() - 60_000;
  rememberPending(request('s-1', 'k-1', first));
  rememberPending(request('s-1', 'k-1', Date.now()));

  expect(pendingRequests().map((entry) => entry.sentAt)).toEqual([first]);
});

it('forgets a request once its result is known', () => {
  rememberPending(request('s-1', 'k-1'));
  rememberPending(request('s-2', 'k-2'));
  forgetPending('k-1');

  expect(pendingRequests().map((entry) => entry.idempotencyKey)).toEqual([
    'k-2',
  ]);
});

it('drops records older than a week and ignores broken storage', () => {
  const now = Date.now();
  rememberPending(request('s-1', 'old', now - 8 * 24 * 60 * 60 * 1000));
  rememberPending(request('s-1', 'new', now));
  expect(pendingRequests(now).map((entry) => entry.idempotencyKey)).toEqual([
    'new',
  ]);

  window.localStorage.clear();
  window.localStorage.setItem(
    'almond.shipment-action-pending.v1:broken',
    '{not json'
  );
  expect(pendingRequests()).toEqual([]);
});

it('keeps another tab’s record that lands while this tab is writing', () => {
  rememberPending(request('s-1', 'k-a'));
  // 이 탭이 저장소에 처음 손대는 순간(읽기든 지우기든) 다른 탭이 새 요청을 남긴다
  const realGet = Storage.prototype.getItem;
  const realRemove = Storage.prototype.removeItem;
  let fired = false;
  const otherTabWrites = () => {
    if (fired) return;
    fired = true;
    getSpy.mockRestore();
    removeSpy.mockRestore();
    rememberPending(request('s-2', 'k-b'));
  };
  const getSpy = jest
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(function (this: Storage, key: string) {
      const value = realGet.call(this, key);
      otherTabWrites();
      return value;
    });
  const removeSpy = jest
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key: string) {
      realRemove.call(this, key);
      otherTabWrites();
    });

  forgetPending('k-a');
  getSpy.mockRestore();
  removeSpy.mockRestore();

  expect(pendingRequests().map((entry) => entry.idempotencyKey)).toEqual([
    'k-b',
  ]);
});
