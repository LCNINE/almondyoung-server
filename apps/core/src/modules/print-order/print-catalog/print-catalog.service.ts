import { Injectable } from '@nestjs/common';
import { PrintCatalogReader, PrintCombo, PrintSize } from './print-catalog.reader';
import { PrintKind } from './print-kind-products';

@Injectable()
export class PrintCatalogService {
  constructor(private readonly reader: PrintCatalogReader) {}

  options(kind: PrintKind, size: PrintSize) {
    return this.reader.options(kind, size);
  }

  quotes(kind: PrintKind, size: PrintSize, combos: PrintCombo[]) {
    return this.reader.quotes(kind, size, combos);
  }
}
