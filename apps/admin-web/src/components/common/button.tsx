// src/components/common/button.tsx
// 버튼

'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn'; // cn 함수 경로가 맞는지 확인해주세요.
import { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: LucideIcon;
    iconPosition?: 'left' | 'right';
    fullWidth?: boolean;
    loading?: boolean;
    'aria-label'?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant = 'primary',
            size = 'md',
            icon: Icon,
            iconPosition = 'left',
            fullWidth = false,
            loading = false,
            disabled,
            children,
            ...props
        },
        ref
    ) => {
        const isDisabled = disabled || loading;

        const baseClasses = [
            'group',
            'inline-flex items-center justify-center gap-1',
            'font-normal text-center transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50',
            'rounded-[5px]',
        ];

        const sizeClasses = {
            sm: 'px-2.5 py-1 text-[11px] leading-[22px] min-h-[27px]',
            md: 'px-4 py-2 text-[13px] leading-[22px] min-h-[38px]',
            lg: 'px-4 py-3 text-[15px] leading-[22px] min-h-[48px]',
        };

        const variantClasses = {
            primary: [
                'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] font-semibold',
                'hover:bg-[var(--btn-primary-bg-hover)]',
                'active:bg-[var(--btn-primary-bg-active)]',
                'focus:ring-[var(--btn-focus-border)]',
                'disabled:bg-[var(--btn-primary-bg-disabled)]',
            ],
            secondary: [
                'bg-[var(--btn-secondary-bg)] text-[var(--btn-secondary-text)] border border-[var(--btn-secondary-border)]',
                'hover:bg-[var(--btn-secondary-bg-hover)]',
                'active:bg-[var(--btn-secondary-bg-active)]',
                'focus:ring-[var(--btn-focus-border)]',
                'disabled:bg-[var(--btn-secondary-bg-disabled)]',
            ],
            outline: [
                'bg-[var(--btn-outline-bg)] text-[var(--btn-outline-text)] border border-[var(--btn-outline-border)]',
                'hover:bg-[var(--btn-outline-bg-hover)] hover:text-[var(--btn-outline-text-hover)] hover:border-[var(--btn-outline-border-hover)]',
                'active:bg-[var(--btn-outline-bg-active)]',
                'focus:ring-[var(--btn-focus-border)]',
                'disabled:text-[var(--btn-outline-text-disabled)] disabled:border-[var(--btn-outline-border-disabled)]',
            ],
            text: [
                'bg-[var(--btn-text-bg)] text-[var(--btn-text-text)] underline',
                'hover:bg-[var(--btn-text-bg-hover)] hover:text-[var(--btn-text-text-hover)]',
                'active:bg-[var(--btn-text-bg-active)]',
                'focus:ring-[var(--btn-focus-border)]',
                'disabled:text-[var(--btn-text-text-disabled)]',
            ],
            ghost: [
                'hover:bg-accent hover:text-accent-foreground',
                'focus:ring-[var(--btn-focus-border)]',
            ],
            danger: [
                'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-text)]',
                'hover:bg-[var(--btn-danger-bg-hover)]',
                'active:bg-[var(--btn-danger-bg-active)]',
                'focus:ring-[var(--btn-focus-border)]',
                'disabled:bg-[var(--btn-danger-bg-disabled)] disabled:text-[var(--btn-danger-text-disabled)]',
            ],
        };

        const iconSize = {
            sm: 16,
            md: 18,
            lg: 16,
        };

        // [수정] `...` 스프레드 연산자를 사용하여 배열을 개별 인자로 펼쳐서 전달합니다.
        const classes = cn(
            ...baseClasses,
            sizeClasses[size],
            ...variantClasses[variant],
            fullWidth && 'w-full',
            className
        );

        if (process.env.NODE_ENV === 'development' && !children && !props['aria-label']) {
            console.warn(
                `[Accessibility Warning] An icon-only button should have an 'aria-label' prop for accessibility.`,
                ref
            );
        }

        const iconElement = Icon && (
            <Icon
                size={iconSize[size]}
                className="flex-shrink-0"
            />
        );

        return (
            <button
                className={classes}
                ref={ref}
                disabled={isDisabled}
                aria-busy={loading}
                {...props}
            >
                {loading && (
                    <div
                        className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                        aria-hidden="true"
                    />
                )}
                {!loading && iconPosition === 'left' && iconElement}
                {children && <span>{children}</span>}
                {!loading && iconPosition === 'right' && iconElement}
            </button>
        );
    }
);

Button.displayName = 'Button';

export { Button };