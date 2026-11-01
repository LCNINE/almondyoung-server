'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useCreateWarehouse } from '@/lib/services/inventory';
import { emptyCreateWarehouseForm, toCreateWarehousePayload } from '../lib/create-form';
import { WAREHOUSE_TYPE_LABELS, WAREHOUSE_TYPES } from '../lib/labels';

/** 두 셸(기존·테넌트)이 같이 쓴다 — 본문에 회사 이름을 적지 않는다. */
export default function WarehouseCreateTemplate() {
  const router = useRouter();
  const mutation = useCreateWarehouse();
  const [form, setForm] = useState(emptyCreateWarehouseForm);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = toCreateWarehousePayload(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    try {
      const warehouse = await mutation.mutateAsync(result.payload);
      toast.success(`${warehouse.name} 창고를 만들었습니다.`);
      router.push('/inventory/warehouses');
    } catch (err) {
      toast.error(getServerDenyMessage(err));
    }
  };

  return (
    <Container>
      <Header
        title="창고 만들기"
        // 서버가 같은 트랜잭션에서 입고 기본·반품 기본·출고 재작업·운송중 로케이션을 함께 만든다.
        subtitle="입고·반품·재작업·운송중 기본 로케이션이 함께 만들어집니다."
      />
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4 px-6 pb-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="warehouse-name">이름</Label>
          <Input
            id="warehouse-name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            aria-invalid={!!error}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="warehouse-type">타입</Label>
          <Select
            value={form.type}
            onValueChange={(value) => {
              const type = WAREHOUSE_TYPES.find((t) => t === value);
              if (type) setForm((prev) => ({ ...prev, type }));
            }}
          >
            <SelectTrigger id="warehouse-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WAREHOUSE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {WAREHOUSE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="warehouse-location">위치</Label>
          <Input
            id="warehouse-location"
            value={form.location}
            onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/inventory/warehouses">취소</Link>
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? '만드는 중...' : '만들기'}
          </Button>
        </div>
      </form>
    </Container>
  );
}
