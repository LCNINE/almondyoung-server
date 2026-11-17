import { Module } from '@nestjs/common';
import { SvgRasterizer } from './svg-rasterizer';

/**
 * 라벨 렌더러 공통부(송장·바코드 라벨 공유). 정적 모듈이다 — Nest 11 은 동적 모듈을 두 번 등록하면
 * 인스턴스가 두 벌이 된다.
 */
@Module({
  providers: [
    // 생성자 인자가 함수라 Nest 가 주입할 수 없다 — 팩토리로 만든다. 폰트는 첫 렌더 때 찾는다(#913).
    { provide: SvgRasterizer, useFactory: () => new SvgRasterizer() },
  ],
  exports: [SvgRasterizer],
})
export class LabelRendererModule {}
