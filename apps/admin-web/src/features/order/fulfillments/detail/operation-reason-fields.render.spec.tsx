/**
 * @jest-environment jsdom
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperationReasonFields } from './operation-reason-fields';
import {
  canSubmitOperationReason,
  operationReasonLabel,
  requestChannelLabel,
  toOperationReasonPayload,
  type OperationReasonValue,
  type ReasonedOperationType,
} from './operation-reasons';

const EMPTY: OperationReasonValue = { otherText: '', note: '' };

let latest: OperationReasonValue = EMPTY;

function Harness({
  type,
  showErrors,
}: {
  type: ReasonedOperationType;
  showErrors?: boolean;
}) {
  const [value, setValue] = useState<OperationReasonValue>(EMPTY);
  latest = value;
  return (
    <OperationReasonFields
      type={type}
      value={value}
      onChange={setValue}
      showErrors={showErrors}
    />
  );
}

describe('canSubmitOperationReason', () => {
  it('사유를 안 골랐으면 제출할 수 없다', () => {
    expect(canSubmitOperationReason('split', EMPTY)).toBe(false);
  });

  it('고객 요청 사유는 요청 경로까지 골라야 제출할 수 있다', () => {
    const picked = { ...EMPTY, reasonCode: 'customer_ship_first' };
    expect(canSubmitOperationReason('split', picked)).toBe(false);
    expect(
      canSubmitOperationReason('split', { ...picked, requestChannel: 'phone' })
    ).toBe(true);
  });

  it('기타는 글이 있어야 제출할 수 있다', () => {
    const picked = { ...EMPTY, reasonCode: 'other' };
    expect(canSubmitOperationReason('split', picked)).toBe(false);
    expect(
      canSubmitOperationReason('split', { ...picked, otherText: '  ' })
    ).toBe(false);
    expect(
      canSubmitOperationReason('split', { ...picked, otherText: '파손 우려' })
    ).toBe(true);
  });

  it('작업에 없는 사유 코드는 제출할 수 없다', () => {
    expect(
      canSubmitOperationReason('recall', { ...EMPTY, reasonCode: 'other' })
    ).toBe(false);
  });
});

describe('toOperationReasonPayload', () => {
  it('목록 사유는 문구를 사유 글로 보내고 빈 값은 키를 넣지 않는다', () => {
    expect(
      toOperationReasonPayload('split', {
        ...EMPTY,
        reasonCode: 'does_not_fit',
      })
    ).toEqual({
      reason: '한 상자에 다 들어가지 않음',
      reasonCode: 'does_not_fit',
    });
  });

  it('기타는 적은 글을, 메모는 앞뒤를 다듬어 보낸다', () => {
    expect(
      toOperationReasonPayload('split', {
        reasonCode: 'other',
        otherText: ' 직접 입력 ',
        note: ' 메모 ',
      })
    ).toEqual({ reason: '직접 입력', reasonCode: 'other', note: '메모' });
  });

  it('고객 요청 사유는 요청 경로를 함께 보낸다', () => {
    expect(
      toOperationReasonPayload('consolidate', {
        ...EMPTY,
        reasonCode: 'customer_ship_together',
        requestChannel: 'kakao',
      })
    ).toEqual({
      reason: '고객이 함께 보내 달라고 요청',
      reasonCode: 'customer_ship_together',
      requestChannel: 'kakao',
    });
  });

  it('고객 요청이 아닌 사유에 남은 요청 경로는 보내지 않는다', () => {
    const payload = toOperationReasonPayload('consolidate', {
      ...EMPTY,
      reasonCode: 'same_address',
      requestChannel: 'kakao',
    });
    expect(payload).not.toHaveProperty('requestChannel');
  });
});

describe('이름표', () => {
  it('아는 코드는 문구로, 모르면 저장된 글 그대로 보인다', () => {
    expect(operationReasonLabel('split', 'does_not_fit', 'x')).toBe(
      '한 상자에 다 들어가지 않음'
    );
    expect(
      operationReasonLabel('split', 'system_plan', 'Shipment planned')
    ).toBe('계획 확정');
    expect(operationReasonLabel('cancel', 'OUT_OF_STOCK', 'x')).toBe(
      '재고 부족'
    );
    expect(operationReasonLabel('split', 'unknown_code', '원문')).toBe('원문');
    expect(operationReasonLabel('split', null, '원문')).toBe('원문');
    expect(requestChannelLabel('store_inquiry')).toBe('쇼핑몰 1:1 문의');
  });
});

describe('OperationReasonFields', () => {
  it('고객 요청 사유를 고르면 요청 경로 묶음이 나타난다', async () => {
    const user = userEvent.setup();
    render(<Harness type="split" />);
    expect(screen.queryByText('고객이 요청한 경로 (필수)')).toBeNull();
    await user.click(
      screen.getByLabelText('고객이 일부 먼저 보내 달라고 요청')
    );
    expect(
      screen.getByRole('radiogroup', { name: '고객이 요청한 경로 (필수)' })
    ).toBeTruthy();
    await user.click(screen.getByLabelText('전화'));
    expect(latest.requestChannel).toBe('phone');
  });

  it('고객 요청이 아닌 사유로 바꾸면 요청 경로 값이 지워진다', async () => {
    const user = userEvent.setup();
    render(<Harness type="split" />);
    await user.click(
      screen.getByLabelText('고객이 일부 먼저 보내 달라고 요청')
    );
    await user.click(screen.getByLabelText('전화'));
    await user.click(screen.getByLabelText('한 상자에 다 들어가지 않음'));
    expect(latest.reasonCode).toBe('does_not_fit');
    expect(latest.requestChannel).toBeUndefined();
    expect(screen.queryByText('고객이 요청한 경로 (필수)')).toBeNull();
  });

  it('기타를 고르면 글 칸이 필수로 나타난다', async () => {
    const user = userEvent.setup();
    render(<Harness type="force_dispatch" />);
    expect(screen.queryByLabelText('기타 사유 (필수)')).toBeNull();
    await user.click(screen.getByLabelText('기타'));
    const input = screen.getByLabelText('기타 사유 (필수)');
    await user.type(input, '현장 판단');
    expect(latest.otherText).toBe('현장 판단');
  });

  it('제출 후 비어 있는 칸은 안내가 칸과 연결돼 보인다', async () => {
    const user = userEvent.setup();
    render(<Harness type="split" showErrors />);
    const group = screen.getByRole('radiogroup', { name: '작업 사유 (필수)' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    const wrapper = group.parentElement as HTMLElement;
    expect(wrapper.getAttribute('role')).toBe('group');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('작업 사유를 골라 주세요.');
    expect(wrapper.getAttribute('aria-describedby')).toBe(alert.id);
    await user.click(
      screen.getByLabelText('고객이 일부 먼저 보내 달라고 요청')
    );
    expect(screen.getByText('고객이 요청한 경로를 골라 주세요.')).toBeTruthy();
  });
});
