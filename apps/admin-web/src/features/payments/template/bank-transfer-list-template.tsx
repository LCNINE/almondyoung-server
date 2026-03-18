'use client';

import { BankTransferTable } from '../components/bank-transfer-table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';

export default function BankTransferListTemplate() {
  return (
    <Container className="divide-y-0">
      <Header title="무통장입금 확인" />
      <BankTransferTable />
    </Container>
  );
}
