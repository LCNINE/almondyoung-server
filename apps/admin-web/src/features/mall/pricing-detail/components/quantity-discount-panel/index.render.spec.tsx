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
  { variantId: 'v-red', name: '빨강', basePrice: 10000, membershipPrice: 8000, combination: 'ov-red' },
  { variantId: 'v-blue', name: '파랑', basePrice: 12000, membershipPrice: 11500, combination: 'ov-blue' },
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
      variantOverrides: [],
    });
  });

  it('saves a members-only table when the regular rate is left blank', () => {
    const { onSave } = renderPanel({ saved: null });

    fireEvent.click(screen.getByRole('button', { name: '구간 추가' }));
    fireEvent.click(screen.getByRole('button', { name: '구간 추가' }));
    fireEvent.change(cell(1, '최소 수량'), { target: { value: '3' } });
    fireEvent.change(cell(1, '멤버십 할인'), { target: { value: '10' } });
    fireEvent.change(cell(2, '최소 수량'), { target: { value: '6' } });
    fireEvent.change(cell(2, '멤버십 할인'), { target: { value: '20' } });

    expect(within(screen.getByTestId('tier-row-0')).getByText('할인 없음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      startsOn: null,
      endsOn: null,
      tiers: [
        { minQuantity: 3, regularRateBp: 0, membershipRateBp: 1000 },
        { minQuantity: 6, regularRateBp: 0, membershipRateBp: 2000 },
      ],
      variantOverrides: [],
    });
  });

  it('blocks a tier with no rate on either side', () => {
    const { onSave } = renderPanel({ saved: null });

    fireEvent.click(screen.getByRole('button', { name: '구간 추가' }));
    fireEvent.change(cell(1, '최소 수량'), { target: { value: '3' } });

    expect(screen.getAllByText('일반 할인과 멤버십 할인이 모두 0 인 구간이 있습니다. 둘 중 하나는 넣어 주세요.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).not.toHaveBeenCalled();
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
      within(screen.getByTestId('tier-row-1')).getByText('수량이 많은 구간일수록 할인율이 커야 합니다. 0(할인 없음)은 앞쪽 구간에만 둘 수 있습니다.'),
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

    expect(onSave).toHaveBeenCalledWith({ enabled: true, startsOn: null, endsOn: null, tiers: [], variantOverrides: [] });
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

describe('QuantityDiscountPanel option overrides', () => {
  const three = [
    ...variants,
    { variantId: 'v-pink', name: '분홍', basePrice: 10000, membershipPrice: 9000, combination: 'ov-pink' },
  ];
  const overrideCell = (card: number, tier: number, column: '최소 수량' | '일반 할인' | '멤버십 할인') =>
    screen.getByLabelText(`예외 ${card} · ${tier}구간 ${column}`) as HTMLInputElement;

  it('hides the exception area for a product with a single option', () => {
    renderPanel({ variants: [variants[0]] });

    expect(screen.queryByText('옵션별 예외')).toBeNull();
    expect(screen.queryByRole('button', { name: '예외 추가' })).toBeNull();
  });

  it('saves picked options with no discount and the rest on the default table', () => {
    const { onSave } = renderPanel({ variants: three });

    fireEvent.click(screen.getByRole('button', { name: '예외 추가' }));
    const card = screen.getByTestId('override-card-1');
    fireEvent.click(within(card).getByLabelText('파랑'));
    fireEvent.click(within(card).getByLabelText('분홍'));
    fireEvent.click(within(card).getByLabelText('할인 없음'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        variantOverrides: [
          { combination: 'ov-blue', tiers: [] },
          { combination: 'ov-pink', tiers: [] },
        ],
      }),
    );
  });

  it('saves a different table for the picked option', () => {
    const { onSave } = renderPanel({ variants: three });

    fireEvent.click(screen.getByRole('button', { name: '예외 추가' }));
    const card = screen.getByTestId('override-card-1');
    fireEvent.click(within(card).getByLabelText('분홍'));
    fireEvent.click(within(card).getByRole('button', { name: '예외 1 · 구간 추가' }));
    fireEvent.change(overrideCell(1, 1, '최소 수량'), { target: { value: '4' } });
    fireEvent.change(overrideCell(1, 1, '일반 할인'), { target: { value: '7' } });
    fireEvent.change(overrideCell(1, 1, '멤버십 할인'), { target: { value: '8' } });

    expect(within(card).getByText('9,300원')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        variantOverrides: [{ combination: 'ov-pink', tiers: [{ minQuantity: 4, regularRateBp: 700, membershipRateBp: 800 }] }],
      }),
    );
  });

  it('blocks saving an exception with no option picked', () => {
    const { onSave } = renderPanel({ variants: three });

    fireEvent.click(screen.getByRole('button', { name: '예외 추가' }));

    expect(screen.getByText('이 예외를 적용할 옵션을 하나 이상 골라 주세요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not let two exceptions pick the same option', () => {
    renderPanel({ variants: three });

    fireEvent.click(screen.getByRole('button', { name: '예외 추가' }));
    fireEvent.click(within(screen.getByTestId('override-card-1')).getByLabelText('파랑'));
    fireEvent.click(screen.getByRole('button', { name: '예외 추가' }));

    const second = screen.getByTestId('override-card-2');
    expect(within(second).getByRole('checkbox', { name: /파랑/ }).hasAttribute('disabled')).toBe(true);
    expect(within(second).getByText(/다른 예외/)).toBeTruthy();
  });

  it('says only the picked options are discounted when the default table is empty', () => {
    const { onSave } = renderPanel({
      variants: three,
      saved: { ...saved, tiers: [], variantOverrides: [{ combination: 'ov-red', tiers: saved.tiers }] },
    });

    expect(screen.getByText('기본: 할인 없음 — 예외로 고른 옵션만 할인됩니다.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ tiers: [], variantOverrides: [{ combination: 'ov-red', tiers: saved.tiers }] }),
    );
  });

  it('shows a member price problem inside the exception that causes it', () => {
    renderPanel({
      variants: three,
      saved: {
        ...saved,
        variantOverrides: [{ combination: 'ov-pink', tiers: [{ minQuantity: 3, regularRateBp: 2000, membershipRateBp: 500 }] }],
      },
    });

    const card = screen.getByTestId('override-card-1');
    expect(within(card).getByText(/분홍: 멤버십 회원가 8,550원이 일반가 8,000원보다 비쌉니다/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists which table each option uses in the option results', () => {
    renderPanel({
      variants: three,
      saved: { ...saved, variantOverrides: [{ combination: 'ov-blue', tiers: [] }] },
    });

    fireEvent.click(screen.getByRole('button', { name: /옵션별 결과 펼치기/ }));
    expect(within(screen.getByTestId('option-result-v-red')).getByText('기본')).toBeTruthy();
    expect(within(screen.getByTestId('option-result-v-blue')).getByText('예외 1')).toBeTruthy();
    expect(within(screen.getByTestId('option-result-v-blue')).getByText('할인 없음')).toBeTruthy();
  });

  it('notes exceptions for options this version no longer has', () => {
    renderPanel({
      variants: three,
      saved: { ...saved, variantOverrides: [{ combination: 'ov-gone', tiers: [] }] },
    });

    expect(screen.getByText('이 버전에 없는 옵션 1개의 예외는 저장할 때 지워집니다.')).toBeTruthy();
  });
});

describe('QuantityDiscountPanel max quantity', () => {
  it('warns about a tier above the max purchase quantity but still saves', () => {
    const { onSave } = renderPanel({ maxQuantity: 4 });

    expect(within(screen.getByTestId('tier-row-1')).getByText('최대구매수량(4개)보다 커서 적용되지 않는 구간입니다.')).toBeTruthy();
    expect(within(screen.getByTestId('tier-row-0')).queryByText(/최대구매수량/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalled();
  });
});
