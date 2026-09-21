import { cn } from '@/lib/utils/cn';
import * as React from 'react';

export type HeadingProps = {
  title: string;
  titleAside?: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
};

const Header = ({ title, titleAside, subtitle, right, className }: HeadingProps) => {
  return (
    <div
      className={cn('flex items-center justify-between px-6 py-4', className)}
    >
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          {titleAside}
        </div>
        {subtitle && <p className="text-sm">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
};

export { Header };
