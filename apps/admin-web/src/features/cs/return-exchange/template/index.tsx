'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ReturnRequestsTable } from '../components/return-requests-table';
import { ExchangeRequestsTable } from '../components/exchange-requests-table';

const RETURN_STATUSES = [
  { value: '', label: '전체' },
  { value: 'requested', label: '신청' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '거절' },
  { value: 'collection_pending', label: '수거 대기' },
  { value: 'collected', label: '수거 완료' },
  { value: 'inspected', label: '검수 완료' },
  { value: 'completed', label: '완료' },
];

const EXCHANGE_STATUSES = [
  { value: '', label: '전체' },
  { value: 'requested', label: '신청' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '거절' },
  { value: 'collected', label: '수거 완료' },
  { value: 'inspected', label: '검수 완료' },
  { value: 'completed', label: '완료' },
];

export default function ReturnExchangeTemplate() {
  const [returnStatus, setReturnStatus] = useState('');
  const [exchangeStatus, setExchangeStatus] = useState('');
  const [returnPage, setReturnPage] = useState(1);
  const [exchangePage, setExchangePage] = useState(1);

  const handleReturnStatusChange = (v: string) => {
    setReturnStatus(v === 'all' ? '' : v);
    setReturnPage(1);
  };

  const handleExchangeStatusChange = (v: string) => {
    setExchangeStatus(v === 'all' ? '' : v);
    setExchangePage(1);
  };

  return (
    <Container className="divide-y-0">
      <Header title="반품/교환 관리" />
      <Tabs defaultValue="returns">
        <TabsList className="mb-4">
          <TabsTrigger value="returns">반품 요청</TabsTrigger>
          <TabsTrigger value="exchanges">교환 요청</TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">상태 필터</span>
            <Select value={returnStatus || 'all'} onValueChange={handleReturnStatusChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETURN_STATUSES.map((s) => (
                  <SelectItem key={s.value || 'all'} value={s.value || 'all'}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ReturnRequestsTable
            statusFilter={returnStatus || undefined}
            page={returnPage}
            onPageChange={setReturnPage}
          />
        </TabsContent>

        <TabsContent value="exchanges" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">상태 필터</span>
            <Select value={exchangeStatus || 'all'} onValueChange={handleExchangeStatusChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCHANGE_STATUSES.map((s) => (
                  <SelectItem key={s.value || 'all'} value={s.value || 'all'}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ExchangeRequestsTable
            statusFilter={exchangeStatus || undefined}
            page={exchangePage}
            onPageChange={setExchangePage}
          />
        </TabsContent>
      </Tabs>
    </Container>
  );
}
