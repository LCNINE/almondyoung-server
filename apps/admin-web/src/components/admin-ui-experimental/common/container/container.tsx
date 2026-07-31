import * as React from 'react';

import { cn } from '@/lib/utils/cn';

type ContainerProps = React.ComponentPropsWithoutRef<'div'> & {
  /** 기본 스타일(shadow-card, w-full, rounded-lg)을 전부 끈다. */
  unstyled?: boolean;
};

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, unstyled = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(!unstyled && 'shadow-card w-full rounded-lg', className)}
        {...props}
      />
    );
  }
);
Container.displayName = 'Container';

export { Container };
