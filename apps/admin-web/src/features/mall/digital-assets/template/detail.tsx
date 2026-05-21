'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { DigitalAssetEditForm } from '../components/edit-form';

export default function DigitalAssetDetailTemplate({ id }: { id: string }) {
  return (
    <Container className="divide-y-0">
      <Header title="디지털 자산 상세" subtitle="메타데이터와 파일 버전 이력을 관리합니다." />
      <DigitalAssetEditForm assetId={id} />
    </Container>
  );
}
