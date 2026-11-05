/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { QuantityDiscountDto } from '@/lib/pricing/quantity-discount';
import { QuantityDiscountPanel, type QuantityDiscountPanelProps } from './index';

const saved: QuantityDiscountDto = {
  id: 'qd-1',
  enabled: true,
  startsOn: null,
  endsOn: null,
  tiers: [
    { minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 },
    { minQuantity: 5, regularRateBp: 1000, membershipRateBp: 1500 },
  ],
};

const variants = [
  { variantId: 'v-red', name: '빨강', basePrice: 10000, membershipPrice: 8000 },
  { variantId: 'v-blue', name: '파랑', basePrice: 12000, membershipPrice: 11500 },
];

function renderPanel(overrides: Partial<QuantityDiscountPanelProps> = {}) {
  const onSave = jest.fn();
  render(
    <QuantityDiscountPanel
      saved={saved}
      variants={variants}
      readonly={false}
      canSave
      isSaving={false}
      serverViolations={[]}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave };
}

const cell = (tier: number, column: '최소 수량' | '일반 할인' | '멤버십 할인') =>
  screen.getByLabelText(`${tier}구간 ${column}`) as HTMLInputElement;

describe('QuantityDiscountPanel', () => {
  it('shows each tier with the resulting prices of the first option', () => {
    renderPanel();

    const firstTier = screen.getByTestId('tier-row-0');
    expect(within(firstTier).getByText('9,500원')).toBeTruthy();
    expect(within(firstTier).getByText('7,200원')).toBeTruthy();
    expect(cell(2, '최소 수량').value).toBe('5');
  });

  it('saves the table in basis points sorted by minimum quantity', () => {
    const { onSave } = renderPanel({ saved: null });

    fireEvent.click(screen.getByRole('button', { name: '구간 추가' }));
    fireEvent.click(screen.getByRole('button', { name: '구간 추가' }));
    fireEvent.change(cell(1, '최소 수량'), { target: { value: '5' } });
    fireEvent.change(cell(1, '일반 할인'), { target: { value: '10' } });
    fireEvent.change(cell(1, '멤버십 할인'), { target: { value: '15' } });
    fireEvent.change(cell(2, '최소 수량'), { target: { value: '3' } });
    fireEvent.change(cell(2, '일반 할인'), { target: { value: '5' } });
    fireEvent.change(cell(2, '멤버십 할인'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: [
        { minQuantity: 3, regularRateBp: 500, membershipRateBp: 1000 },
        { minQuantity: 5, regularRateBp: 1000, membershipRateBp: 1500 },
      ],
    });
  });

  it('blocks saving and names the option when members would pay more', () => {
    const { onSave } = renderPanel();

    fireEvent.change(cell(1, '일반 할인'), { target: { value: '20' } });
    fireEvent.change(cell(1, '멤버십 할인'), { target: { value: '1' } });

    expect(screen.getByText(/파랑: 멤버십 회원가 11,380원이 일반가 9,600원보다 비쌉니다/)).toBeTruthy();
    const save = screen.getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows violations returned by the server next to the tier', () => {
    renderPanel({ serverViolations: [{ code: 'RATE_NOT_INCREASING', tierIndex: 1 }] });

    expect(
      within(screen.getByTestId('tier-row-1')).getByText('수량이 많은 구간일수록 일반 %와 멤버십 %가 모두 커야 합니다.'),
    ).toBeTruthy();
  });

  it('sends the chosen period dates', () => {
    const { onSave } = renderPanel();

    fireEvent.click(screen.getByLabelText('기간 지정'));
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ startsOn: '2026-12-01', endsOn: '2026-12-31' }));
  });

  it('removes the whole table by saving no tiers', () => {
    const { onSave } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '구간표 삭제' }));

    expect(onSave).toHaveBeenCalledWith({ enabled: true, startsOn: null, endsOn: null, tiers: [] });
  });

  it('stops adding tiers at five', () => {
    renderPanel({ saved: null });
    const add = screen.getByRole('button', { name: '구간 추가' }) as HTMLButtonElement;
    for (let i = 0; i < 5; i += 1) fireEvent.click(add);

    expect(add.disabled).toBe(true);
  });

  it('is read-only for an active version', () => {
    renderPanel({ readonly: true });

    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(cell(1, '최소 수량').disabled).toBe(true);
    expect(screen.getByText('활성 버전은 읽기 전용입니다.')).toBeTruthy();
  });
});

describe('QuantityDiscountPanel server errors', () => {
  it('hides a server error once the admin edits the table', () => {
    render(
      <QuantityDiscountPanel
        saved={saved}
        variants={variants}
          readonly={false}
        canSave
        isSaving={false}
        serverViolations={[{ code: 'PERIOD_REVERSED' }]}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText('시작일이 종료일보다 늦습니다.')).toBeTruthy();

    fireEvent.change(cell(1, '일반 할인'), { target: { value: '6' } });

    expect(screen.queryByText('시작일이 종료일보다 늦습니다.')).toBeNull();
  });
});
