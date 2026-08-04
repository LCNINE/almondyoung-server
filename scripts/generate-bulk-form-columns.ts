import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildColumnsJson,
  buildColumnsMarkdown,
} from '../apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc';

const ROOT = join(__dirname, '..', 'skills', 'product-bulk-form');

function write(relative: string, content: string): void {
  const path = join(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`wrote ${path}`);
}

write('references/columns.md', buildColumnsMarkdown());
write('scripts/columns.json', buildColumnsJson());
