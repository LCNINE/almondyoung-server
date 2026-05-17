'use client';

import { TwoColumnPage } from '@/components/admin-ui-experimental/layout';
import { ProductDetailGeneral } from '../components/general';
import { ProductDetailImages } from '../components/images';
import { ProductDetailOptions } from '../components/options';
import { ProductDetailVariants } from '../components/variants';

type Props = {
  masterId: string;
};

export default function ProductsDetailTemplate({ masterId }: Props) {
  return (
    <TwoColumnPage>
      <TwoColumnPage.Main>
        <ProductDetailGeneral masterId={masterId} />
        <ProductDetailOptions masterId={masterId} />
        <ProductDetailVariants masterId={masterId} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <ProductDetailImages masterId={masterId} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
}
