import { cn } from '@/lib/utils/cn';
import * as React from 'react';

export type HeadingProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
};

const Header = ({ title, subtitle, right, className }: HeadingProps) => {
  return (
    <div
      className={cn('flex items-center justify-between px-6 py-4', className)}
    >
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-sm">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
};

export { Header };
