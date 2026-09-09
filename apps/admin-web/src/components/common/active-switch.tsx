'use client';

import { Switch } from '@/components/ui/switch';

type Props = React.ComponentProps<typeof Switch>;

/** 노출/활성 토글. 켜짐이 초록인 것을 여기 한 곳에서만 정한다 */
export function ActiveSwitch({ className, ...props }: Props) {
  return (
    <Switch
      {...props}
      className={`data-[state=checked]:bg-[#22c55e] ${className ?? ''}`}
    />
  );
}
