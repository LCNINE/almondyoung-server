import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { flash, press, scan, typeHuman } from '../outbound/__fixtures__/renderStation';
import { AWAITING, PARTIAL, READY, listed, orderNos, setupReturns } from './__fixtures__/renderReturns';

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const row = (orderNo: string) => {
  const found = screen.getAllByRole('option').find((r) => r.getAttribute('data-order-no') === orderNo);
  if (!found) throw new Error(`row ${orderNo} not found`);
  return found;
};
const searchBox = () => screen.getByRole('searchbox', { name: '반품 검색' });

describe('도착 대기 목록', () => {
  it('검수 대기·덜 옴이 위로, 고객명은 가린 값, 도착 대기에는 단계 글자가 없다 — 이 창고 것만', async () => {
    const { server } = setupReturns();
    expect(await listed()).toEqual(['O-1003', 'O-1002', 'O-1001']);
    expect(server.listQueries()[0].get('warehouseId')).toBe('w-1');
    expect(within(row('O-1003')).getByText('검수 대기')).toBeInTheDocument();
    expect(within(row('O-1002')).getByText('덜 옴')).toBeInTheDocument();
    expect(row('O-1001')).not.toHaveTextContent(/검수 대기|덜 옴|도착 대기/);
    expect(within(row('O-1001')).getByText('김민*')).toBeInTheDocument();
    expect(screen.queryByText('김민영')).toBeNull();
    expect(within(row('O-1002')).getByText('헤어클립 집게핀 외 1건')).toBeInTheDocument();
    expect(screen.queryByText(/외 \d+건 — 검색하세요/)).toBeNull();
  });

  it('목록이 비면 한 줄', async () => {
    setupReturns({ returns: [] });
    expect(await screen.findByText('도착 대기 반품이 없어요')).toBeInTheDocument();
  });

  it('더 있으면 «외 N건 — 검색하세요»', async () => {
    const { server } = setupReturns();
    server.config.limit = 2;
    expect(await listed()).toEqual(['O-1003', 'O-1002']);
    expect(screen.getByText('외 1건 — 검색하세요')).toBeInTheDocument();
  });

  it('창고 미설정이면 창고 선택', async () => {
    const { server } = setupReturns({ prefs: createMemoryPrefs() });
    expect(await screen.findByRole('button', { name: /부천 창고/ })).toBeInTheDocument();
    expect(server.listQueries()).toEqual([]);
  });
});

describe('검색', () => {
  it('F9 → 검색칸(포커스), Enter → q 로 조회, Esc → 지움', async () => {
    const { server } = setupReturns();
    await listed();
    expect(bar().getByRole('button', { name: /F9\s*검색/ })).toBeInTheDocument();
    expect(bar().queryByRole('button', { name: /검색 지우기/ })).toBeNull();
    press('F9');
    const box = searchBox();
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: '김민' } });
    fireEvent.submit(box);
    await waitFor(() => expect(orderNos()).toEqual(['O-1001']));
    expect(server.listQueries().at(-1)?.get('q')).toBe('김민');
    expect(screen.queryByRole('searchbox')).toBeNull();
    await waitFor(() => expect(bar().getByRole('button', { name: /검색 지우기/ })).toBeInTheDocument());
    press('Escape');
    await waitFor(() => expect(orderNos()).toEqual(['O-1003', 'O-1002', 'O-1001']));
    expect(server.listQueries().at(-1)?.has('q')).toBe(false);
    await waitFor(() => expect(bar().queryByRole('button', { name: /검색 지우기/ })).toBeNull());
  });

  it('검색칸이 열려 있을 때 Esc 는 칸을 닫는다', async () => {
    setupReturns();
    await listed();
    press('F9');
    await waitFor(() => expect(bar().getByRole('button', { name: /검색 지우기/ })).toBeInTheDocument());
    press('Escape');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('숫자를 치기 시작해도 검색칸이 열린다 — 친 숫자부터', async () => {
    const { server } = setupReturns();
    await listed();
    await typeHuman(['1']);
    const box = searchBox();
    expect(box).toHaveFocus();
    expect(box).toHaveValue('1');
    fireEvent.change(box, { target: { value: 'O-1002' } });
    fireEvent.submit(box);
    await waitFor(() => expect(orderNos()).toEqual(['O-1002']));
    expect(server.listQueries().at(-1)?.get('q')).toBe('O-1002');
  });

  it('찾는 반품이 없으면 한 줄', async () => {
    setupReturns();
    await listed();
    press('F9');
    fireEvent.change(searchBox(), { target: { value: '없는 이름' } });
    fireEvent.submit(searchBox());
    expect(await screen.findByText('찾는 반품이 없어요')).toBeInTheDocument();
  });
});

describe('상품 스캔', () => {
  it('목록에서 상품을 찍으면 barcode 로 조회, 하나면 그 반품이 열린다(소포 세기)', async () => {
    const { server } = setupReturns();
    await listed();
    scan('8801001');
    expect(await screen.findByRole('region', { name: '소포 세기' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'O-1001' })).toBeInTheDocument();
    expect(server.listQueries().at(-1)?.get('barcode')).toBe('8801001');
    expect(server.requests.some((r) => r.path === '/admin/customer-return-receiving/cr-1')).toBe(true);
  });

  it('둘 이상이면 걸러진 목록에서 고른다', async () => {
    const twin = { ...AWAITING, id: 'cr-5', orderNo: 'O-1005', requestedAt: '2026-10-23T01:00:00.000Z' };
    setupReturns({ returns: [AWAITING, twin, READY] });
    await listed();
    scan('8801001');
    await waitFor(() => expect(orderNos()).toEqual(['O-1001', 'O-1005']));
    expect(screen.queryByRole('region', { name: '소포 세기' })).toBeNull();
  });

  it('없는 상품이면 오류음', async () => {
    setupReturns();
    await listed();
    scan('9999999');
    expect(await screen.findByText('찾는 반품이 없어요')).toBeInTheDocument();
    await waitFor(() => expect(flash()).toBe('error'));
  });
});

describe('열기', () => {
  it('↑↓ + Enter 로 연다 — 덜 옴은 소포 세기, Esc 로 목록', async () => {
    setupReturns();
    await listed();
    expect(row('O-1003')).toHaveAttribute('aria-selected', 'true');
    await typeHuman(['ArrowDown', 'ArrowDown', 'ArrowUp']);
    expect(row('O-1002')).toHaveAttribute('aria-selected', 'true');
    await typeHuman(['Enter']);
    expect(await screen.findByRole('region', { name: '소포 세기' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'O-1002' })).toBeInTheDocument();
    await waitFor(() => expect(bar().getByRole('button', { name: /목록/ })).toBeInTheDocument());
    press('Escape');
    expect(await listed()).toEqual(['O-1003', 'O-1002', 'O-1001']);
  });

  it('검수 대기를 열면 검수', async () => {
    setupReturns();
    await listed();
    await typeHuman(['Enter']);
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'O-1003' })).toBeInTheDocument();
  });

  it('행을 눌러도 연다', async () => {
    setupReturns();
    await listed();
    fireEvent.click(within(row('O-1001')).getByRole('button'));
    expect(await screen.findByRole('region', { name: '소포 세기' })).toBeInTheDocument();
  });

  it('그 사이 취소된 반품이면 «취소된 반품이에요» 뒤 목록 — 목록도 다시 읽는다', async () => {
    const { server } = setupReturns({ returns: [AWAITING, PARTIAL] });
    await listed();
    server.setStatus(PARTIAL.id, 'cancelled');
    await typeHuman(['Enter']);
    expect(await screen.findByRole('alert')).toHaveTextContent('취소된 반품이에요');
    expect(flash()).toBe('error');
    await waitFor(() => expect(orderNos()).toEqual(['O-1001']));
    expect(screen.queryByRole('region', { name: '소포 세기' })).toBeNull();
  });

  it('그 사이 다른 스테이션이 검수했으면 «끝난 반품이에요»', async () => {
    const { server } = setupReturns({ returns: [READY] });
    await listed();
    server.setStatus(READY.id, 'inspected');
    await typeHuman(['Enter']);
    expect(await screen.findByRole('alert')).toHaveTextContent('끝난 반품이에요');
  });

  it('상세를 못 읽으면 오류 한 줄, 목록 그대로', async () => {
    const { server } = setupReturns();
    await listed();
    server.failNext({ method: 'GET' });
    await typeHuman(['Enter']);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(flash()).toBe('error');
    expect(orderNos()).toEqual(['O-1003', 'O-1002', 'O-1001']);
  });
});
