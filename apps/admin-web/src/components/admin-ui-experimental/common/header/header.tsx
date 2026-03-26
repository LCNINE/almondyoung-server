import { cn } from '@/lib/utils/cn';
import * as React from 'react';

export type HeadingProps = {
  title: string;
  subtitle?: string;
};

const Header = ({ title, subtitle }: HeadingProps) => {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-sm">{subtitle}</p>}
      </div>
    </div>
  );
};

export { Header };
