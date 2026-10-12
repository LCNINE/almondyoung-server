'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

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

export function TimeSaleHelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <TimeSaleDialog
      open={open}
      onClose={onClose}
      title="타임세일 출력 위치 설정"
    >
      <div className="ts-help">
        <p>
          · 진행 중인 타임세일을 모두 합쳐 쇼핑몰의 타임세일 영역 한 곳에
          표시합니다. 세일 이름은 고객에게 보이지 않습니다.
        </p>
        <ol className="ts-help-steps">
          <li>타임세일 목록에서 세일을 공개합니다.</li>
          <li>메인·더보기 매대 스타일을 고르고 저장합니다.</li>
          <li>각 스타일의 PC·모바일 모습을 미리보기로 확인합니다.</li>
        </ol>
        {[
          [
            '메인 매대',
            '/kr',
            '홈의 타임세일 섹션입니다. 상위 10개 상품과 카테고리 탭을 보여줍니다.',
          ],
          [
            '더보기 매대',
            '/kr/time-sale',
            '진행 중인 세일 상품 전체를 카테고리 탭과 페이지로 보여줍니다.',
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
      </div>
    </TimeSaleDialog>
  );
}
