import { Injectable } from '@nestjs/common';
import { PrintCatalogReader, PrintCombo, PrintSize } from './print-catalog.reader';
import { PrintKind } from './print-kind-products';
import { PrintProductPublisher, PublishPrintProductInput, PublishPrintProductResult } from './print-product-publisher';

@Injectable()
export class PrintCatalogService {
  constructor(
    private readonly reader: PrintCatalogReader,
    private readonly publisher: PrintProductPublisher,
  ) {}

  options(kind: PrintKind, size: PrintSize) {
    return this.reader.options(kind, size);
  }

  quotes(kind: PrintKind, size: PrintSize, combos: PrintCombo[]) {
    return this.reader.quotes(kind, size, combos);
  }

  publish(input: PublishPrintProductInput, userId: string): Promise<PublishPrintProductResult> {
    return this.publisher.publish(input, userId);
  }
}
