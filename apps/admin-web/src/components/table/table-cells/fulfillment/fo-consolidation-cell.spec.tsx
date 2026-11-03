/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { FoConsolidationCell } from './fo-consolidation-cell';
import { FoStatusCell } from './fo-status-cell';

describe('FoConsolidationCell', () => {
  it('합칠 수 있으면 짝 주문을 알려요', () => {
    render(
      <FoConsolidationCell
        value={{ state: 'mergeable', partnerOrderNos: ['6322'] }}
      />
    );

    expect(screen.getByText('#6322와 합칠 수 있어요')).toBeTruthy();
  });

  it('이미 합쳐졌으면 한 상자라고 알려요', () => {
    render(
      <FoConsolidationCell
        value={{ state: 'merged', partnerOrderNos: ['6275'] }}
      />
    );

    expect(screen.getByText('#6275와 한 상자')).toBeTruthy();
  });

  it('합치는 중이면 amber 배지로 보여요', () => {
    render(
      <FoConsolidationCell
        value={{ state: 'merging', partnerOrderNos: ['6275'] }}
      />
    );

    const badge = screen.getByText('#6275와 합치는 중');

    expect(badge.className).toContain('bg-amber-100');
  });

  it('짝이 여럿이면 외 N건으로 줄여요', () => {
    render(
      <FoConsolidationCell
        value={{ state: 'merging', partnerOrderNos: ['6275', '6280'] }}
      />
    );

    expect(screen.getByText('#6275 외 1건과 합치는 중')).toBeTruthy();
  });

  it('받침 있는 번호에는 과를 붙여요', () => {
    render(
      <FoConsolidationCell
        value={{ state: 'mergeable', partnerOrderNos: ['6321'] }}
      />
    );

    expect(screen.getByText('#6321과 합칠 수 있어요')).toBeTruthy();
  });

  it('합칠 일이 없으면 아무것도 그리지 않아요', () => {
    const { container } = render(
      <FoConsolidationCell value={{ state: 'none', partnerOrderNos: [] }} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('조회에 실패했으면 아무것도 그리지 않아요', () => {
    const { container } = render(<FoConsolidationCell value={null} />);

    expect(container.textContent).toBe('');
  });
});

describe('FoStatusCell 합포장', () => {
  it('합포장 중이면 합포장 중 배지를 amber 로 보여요', () => {
    render(
      <FoStatusCell
        value="recovery_required"
        consolidation={{ state: 'merging', partnerOrderNos: ['6275'] }}
      />
    );

    const badge = screen.getByText('합포장 중');

    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-700');
  });

  it('합포장 중이 아니면 복구필요를 유지해요', () => {
    render(
      <FoStatusCell
        value="recovery_required"
        consolidation={{ state: 'none', partnerOrderNos: [] }}
      />
    );

    expect(screen.getByText('복구필요')).toBeTruthy();
  });

  it('조회 실패여도 원래 상태를 보여요', () => {
    render(<FoStatusCell value="ready" consolidation={null} />);

    expect(screen.getByText('준비됨')).toBeTruthy();
  });
});
