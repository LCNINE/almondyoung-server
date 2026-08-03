import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { WarehouseProvider, useWarehouse } from './warehouse-context';

function Probe() {
  const { warehouseId, warehouseName, isSet, setWarehouse, clearWarehouse } =
    useWarehouse();
  return (
    <div>
      <span data-testid="id">{warehouseId ?? '없음'}</span>
      <span data-testid="name">{warehouseName ?? '없음'}</span>
      <span data-testid="isSet">{String(isSet)}</span>
      <button onClick={() => setWarehouse({ id: 'w-1', name: '본창고' })}>
        선택
      </button>
      <button onClick={clearWarehouse}>해제</button>
    </div>
  );
}

describe('warehouse-context', () => {
  it('저장된 창고가 없으면 미설정이다', () => {
    render(
      <WarehouseProvider prefs={createMemoryPrefs()}>
        <Probe />
      </WarehouseProvider>
    );
    expect(screen.getByTestId('isSet')).toHaveTextContent('false');
    expect(screen.getByTestId('id')).toHaveTextContent('없음');
  });

  it('저장된 창고를 복원한다', () => {
    const prefs = createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({ id: 'w-9', name: '제2창고' }),
    });
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );
    expect(screen.getByTestId('id')).toHaveTextContent('w-9');
    expect(screen.getByTestId('name')).toHaveTextContent('제2창고');
    expect(screen.getByTestId('isSet')).toHaveTextContent('true');
  });

  it('선택하면 상태와 저장소가 함께 바뀐다', async () => {
    const prefs = createMemoryPrefs();
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: '선택' }));

    expect(screen.getByTestId('id')).toHaveTextContent('w-1');
    expect(prefs.get('almondwms.warehouse')).toBe(
      JSON.stringify({ id: 'w-1', name: '본창고' })
    );
  });

  it('해제하면 저장소에서도 지운다', async () => {
    const prefs = createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({ id: 'w-9', name: '제2창고' }),
    });
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: '해제' }));

    expect(screen.getByTestId('isSet')).toHaveTextContent('false');
    expect(prefs.get('almondwms.warehouse')).toBeNull();
  });

  it('저장값이 깨져 있으면 미설정으로 떨어진다', () => {
    const prefs = createMemoryPrefs({ 'almondwms.warehouse': '{not json' });
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );
    expect(screen.getByTestId('isSet')).toHaveTextContent('false');
  });

  it('Provider 밖에서 쓰면 명시적으로 실패한다', () => {
    expect(() => render(<Probe />)).toThrow(/WarehouseProvider/);
  });
});
