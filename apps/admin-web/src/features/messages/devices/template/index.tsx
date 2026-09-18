'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { SmsDeviceStatus } from '@/lib/api/domains/sms-gate';
import { useSmsDevices } from '@/lib/services/sms-gate';
import { DeviceCard } from '../components/device-card';
import { DeviceFormDialog } from '../components/device-form-dialog';

export default function SmsDevicesTemplate() {
  const { data, isLoading, isError } = useSmsDevices();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SmsDeviceStatus | null>(null);

  return (
    <Container>
      <Header
        title="발송폰 디바이스"
        subtitle={
          data ? `SMS Gate 앱이 설치된 발송폰의 연결 상태와 오늘 사용량입니다. 발송 대기 ${data.pendingCount.toLocaleString()}건` : undefined
        }
        right={
          <Button variant="outline" onClick={() => setCreating(true)}>
            디바이스 등록
          </Button>
        }
      />

      <div className="px-6 pb-6">
        {isLoading && (
          <div className="flex gap-4">
            <Skeleton className="h-[600px] w-[280px] rounded-[49px]" />
            <Skeleton className="h-[600px] w-[280px] rounded-[49px]" />
          </div>
        )}
        {isError && <p className="text-destructive text-sm">디바이스 상태를 불러오지 못했습니다.</p>}
        {data && data.devices.length === 0 && (
          <p className="text-muted-foreground text-sm">등록된 발송폰이 없습니다.</p>
        )}
        {data && data.devices.length > 0 && (
          <div className="flex items-start gap-6 overflow-x-auto sm:flex-wrap sm:gap-4 sm:overflow-x-visible">
            {data.devices.map((device) => (
              <DeviceCard key={device.id} device={device} onEdit={() => setEditing(device)} />
            ))}
          </div>
        )}
      </div>

      <DeviceFormDialog open={creating} onOpenChange={setCreating} />
      <DeviceFormDialog
        open={editing !== null}
        device={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Container>
  );
}
