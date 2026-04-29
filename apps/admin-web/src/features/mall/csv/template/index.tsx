'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { TemplateSection } from '../components/template-section';
import { ImportSection } from '../components/import-section';
import { ExportSection } from '../components/export-section';

interface Props {
  userId: string;
}

export default function CsvTemplate({ userId }: Props) {
  return (
    <div className="flex flex-col gap-y-4">
      <Container>
        <Header
          title="CSV 가져오기/내보내기"
          subtitle="CSV 파일로 상품을 일괄 등록하거나 내보낼 수 있습니다."
        />
      </Container>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Container className="divide-y-0">
          <TemplateSection />
        </Container>
        <Container className="divide-y-0 md:col-span-2">
          <ImportSection userId={userId} />
        </Container>
      </div>

      <Container className="divide-y-0">
        <ExportSection />
      </Container>
    </div>
  );
}
