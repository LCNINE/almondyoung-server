'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { IssueInvoiceForm } from '../components/issue-invoice-form';

export default function PrintInvoicesByOrderTemplate() {
  return (
    <Container className="divide-y-0">
      <Header
        title="송장 출력"
        subtitle="풀필먼트 주문 단위로 송장을 발행하고 출력합니다."
      />
      <div className="p-4">
        <IssueInvoiceForm />
      </div>
    </Container>
  );
}
