'use client';

import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CircleHelp,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function TimeSaleExplanation({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ts-field-help"
          aria-label={`${label} 설명`}
        >
          <CircleHelp size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[100] text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function TimeSaleDialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
  width,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  width?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        className={`ts-modal ${wide ? 'ts-modal-wide' : ''}`}
        aria-describedby={undefined}
        style={
          width
            ? { width: `min(${width}px, calc(100vw - 64px))`, maxWidth: width }
            : undefined
        }
      >
        <DialogTitle className="ts-modal-title">{title}</DialogTitle>
        <div className="ts-modal-body">{children}</div>
        <footer className="ts-modal-footer">
          {footer}
          <button
            type="button"
            className="ts-button ts-button-neutral"
            onClick={onClose}
          >
            닫기
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function TimeSaleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      className="ts-switch"
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function TimeSaleOrderButtons({
  disabled,
  onMove,
}: {
  disabled: boolean;
  onMove: (direction: 'first' | 'up' | 'down' | 'last') => void;
}) {
  return (
    <div className="ts-order-buttons">
      {(
        [
          ['first', '처음', ArrowUp],
          ['up', '위', ChevronUp],
          ['down', '아래', ChevronDown],
          ['last', '마지막', ArrowDown],
        ] as const
      ).map(([direction, label, Icon]) => (
        <button
          key={direction}
          type="button"
          className="ts-icon-button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={() => onMove(direction)}
        >
          <Icon size={22} />
        </button>
      ))}
    </div>
  );
}

export function TimeSaleHelpDialog({
  open,
  onClose,
  partitionId,
}: {
  open: boolean;
  onClose: () => void;
  partitionId?: string;
}) {
  return (
    <TimeSaleDialog
      open={open}
      onClose={onClose}
      title={
        partitionId
          ? `메인 매대 파티션 연결 코드 - ${partitionId}`
          : '타임세일 출력 위치 설정'
      }
    >
      <div className="ts-help">
        {partitionId ? (
          <>
            <p>
              · home-sale은 기본 홈 구역, home-top은 홈 상단 구역입니다. 다른
              구역은 쇼핑몰 코드의 원하는 위치에 아래 컴포넌트를 연결합니다.
            </p>
            <p>
              · 해당 파티션ID가 설정된 타임세일 메인 매대만 특정 페이지, 특정
              위치에 노출할 수 있습니다.
            </p>
            <div className="ts-help-code">
              <header>파티션ID : {partitionId}</header>
              <code>{`<TimeSaleWrapper countryCode={countryCode} partitionId={${JSON.stringify(partitionId)}} />`}</code>
            </div>
          </>
        ) : (
          <>
            <p>
              · 우리 쇼핑몰은 저장된 타임세일 설정을 각 페이지의 타임세일 영역에
              자동으로 표시합니다.
            </p>
            <ol className="ts-help-steps">
              <li>상단의 서비스를 켜고 타임세일을 활성화합니다.</li>
              <li>
                타임세일에서 메인·더 보기·상세 스타일을 선택하고 저장합니다.
              </li>
              <li>각 스타일의 PC·모바일 표시 설정과 할인 기간을 확인합니다.</li>
              <li>
                메인 매대의 파티션ID를 비우면 기본 홈 구역에 표시됩니다.
                home-top을 입력하면 홈 상단 구역에 표시됩니다.
              </li>
            </ol>
            {[
              [
                '메인 매대',
                '/kr',
                '기본 홈 구역: home-sale / 홈 상단 구역: home-top',
              ],
              [
                '더 보기 매대',
                '/kr/time-sale',
                '메인 매대의 더 보기에서 해당 타임세일 상품을 표시합니다.',
              ],
              [
                '상품 상세',
                '/kr/products/[상품 주소]',
                '해당 타임세일 상품의 상세 페이지에 선택한 상세 스타일을 표시합니다.',
              ],
            ].map(([label, path, description]) => (
              <div key={label}>
                <p>{label}</p>
                <div className="ts-help-code">
                  <header>페이지 : {path}</header>
                  <code>{description}</code>
                </div>
              </div>
            ))}
            <p className="ts-help-note">
              새로운 출력 위치가 필요하면 쇼핑몰 코드에 TimeSaleWrapper를
              연결하고 같은 파티션ID를 지정합니다. 목록의 CODE 버튼에서 연결
              예시를 확인할 수 있습니다.
            </p>
          </>
        )}
      </div>
    </TimeSaleDialog>
  );
}
