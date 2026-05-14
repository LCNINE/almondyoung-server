'use client';

import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { ProductDetailGeneral } from '../components/general';
import { ProductDetailVariants } from '../components/variants';

type Props = {
  masterId: string;
};

export default function ProductsDetailTemplate({ masterId }: Props) {
  return (
    <TwoColumnPage>
      <ProductDetailGeneral masterId={masterId} />
      <ProductDetailVariants masterId={masterId} />
    </TwoColumnPage>
  );
}
