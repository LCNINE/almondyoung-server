/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { SenderPreviewLine, SenderPreviewSummary } from './sender-preview';

const useWaybillSenderPreview = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  useWaybillSenderPreview: (...args: unknown[]) =>
    useWaybillSenderPreview(...args),
}));

beforeEach(() => useWaybillSenderPreview.mockReset());

describe('SenderPreviewLine', () => {
  it('서버가 고른 이름과 출처를 보인다', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      data: [
        {
          shipmentId: 's1',
          name: '위탁업체',
          source: 'profile',
          beforePlan: false,
        },
      ],
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(useWaybillSenderPreview).toHaveBeenCalledWith(['s1']);
    expect(screen.getByText('위탁업체')).toBeTruthy();
    expect(screen.getByText('(배송 프로필)')).toBeTruthy();
  });

  it('조회가 실패하면 이름 대신 확인 불가', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(screen.getByText('확인 불가, 발급 전 설정 확인')).toBeTruthy();
  });
});

describe('SenderPreviewLine 재발급', () => {
  it('재발급하면 바뀌는 이름을 미리 알린다', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        {
          shipmentId: 's1',
          name: '옛 이름',
          source: 'waybill',
          beforePlan: false,
          reissue: { name: '위탁업체', source: 'profile' },
        },
      ],
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(
      screen.getByText('재발급하면 이름 위탁업체(배송 프로필)로 바뀌어요')
    ).toBeTruthy();
  });

  it('이름이 같아도 전화·출고지가 바뀌면 바뀌는 값을 알린다', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        {
          shipmentId: 's1',
          name: '위탁업체',
          source: 'waybill',
          phone: '02-1',
          phoneSource: 'waybill',
          origin: { zip: '1', baseAddress: '옛 주소', detailAddress: '' },
          originSource: 'waybill',
          beforePlan: false,
          reissue: {
            name: '위탁업체',
            source: 'profile',
            phone: '031-2',
            phoneSource: 'profile',
            origin: { zip: '1', baseAddress: '옛 주소', detailAddress: '' },
            originSource: 'profile',
          },
        },
      ],
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(
      screen.getByText('재발급하면 전화 031-2(배송 프로필)로 바뀌어요')
    ).toBeTruthy();
  });
});

describe('SenderPreviewLine 전화·출고지·반품지', () => {
  it('송장에 찍힐 전화·출고지와 칸별 출처를 보이고, 반품지는 값 대신 싣지 않는다고 적는다', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        {
          shipmentId: 's1',
          name: '위탁업체',
          source: 'profile',
          phone: '031-2',
          phoneSource: 'profile',
          origin: {
            zip: '14000',
            baseAddress: '경기 길 1',
            detailAddress: '2층',
          },
          originSource: 'default',
          beforePlan: false,
        },
      ],
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(screen.getByText('031-2')).toBeTruthy();
    expect(screen.getByText('(14000) 경기 길 1 2층')).toBeTruthy();
    expect(screen.getByText('(기본값으로 대체)')).toBeTruthy();
    expect(screen.getByText(/송장·한진 접수에 따로 싣지 않아요/)).toBeTruthy();
  });

  it('옛 Core 가 전화·주소를 보내지 않으면 그 칸은 확인 불가', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        {
          shipmentId: 's1',
          name: '위탁업체',
          source: 'profile',
          beforePlan: false,
        },
      ],
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(screen.getAllByText('확인 불가')).toHaveLength(2);
  });

  it('이름이 확인 불가면 전화·출고지 칸을 그리지 않는다', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    });
    render(<SenderPreviewLine shipmentId="s1" />);

    expect(screen.queryByText('보내는 분 전화')).toBeNull();
    expect(screen.queryByText('출고지')).toBeNull();
  });
});

describe('SenderPreviewSummary', () => {
  it('보내는 분별 상자 수와 확인 불가 상자를 함께 보인다', () => {
    useWaybillSenderPreview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        {
          shipmentId: 'a',
          name: '위탁업체',
          source: 'profile',
          beforePlan: false,
        },
        { shipmentId: 'b', name: '우리', source: 'default', beforePlan: false },
        {
          shipmentId: 'c',
          name: null,
          source: 'unknown',
          beforePlan: true,
          reason: 'profile_incompatible',
        },
      ],
    });
    render(<SenderPreviewSummary shipmentIds={['a', 'b', 'c']} />);

    expect(screen.getByText('위탁업체')).toBeTruthy();
    expect(screen.getByText('(기본 송화인으로 대체)')).toBeTruthy();
    expect(screen.getByText('확인 불가, 발급 전 설정 확인')).toBeTruthy();
    expect(
      screen.getByText('(상품의 배송 프로필이 서로 달라 확정이 막혀요)')
    ).toBeTruthy();
    expect(screen.getAllByText('1상자')).toHaveLength(3);
  });
});
