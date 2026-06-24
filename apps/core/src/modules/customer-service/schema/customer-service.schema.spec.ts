import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  csCases,
  csCaseComments,
  csCaseCommentMentions,
  csCaseCommentAttachments,
  csCaseEvents,
  csLabels,
  csCaseLabels,
  customerServiceSchema,
} from './customer-service.schema';

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

describe('customer-service schema', () => {
  it('drops removed columns and adds new ones on cs_cases', () => {
    const cols = columnNames(csCases);
    expect(cols).toContain('source_channel');
    expect(cols).toContain('external_thread_ref');
    expect(cols).not.toContain('reason_code');
    expect(cols).not.toContain('customer_email');
    expect(cols).not.toContain('customer_phone');
    expect(cols).not.toContain('resolved_at');
  });

  it('registers all seven tables in the schema object', () => {
    expect(Object.keys(customerServiceSchema)).toEqual(
      expect.arrayContaining([
        'csCases',
        'csCaseComments',
        'csCaseCommentMentions',
        'csCaseCommentAttachments',
        'csCaseEvents',
        'csLabels',
        'csCaseLabels',
      ]),
    );
  });

  it('models comment soft-delete and event payload columns', () => {
    expect(columnNames(csCaseComments)).toEqual(
      expect.arrayContaining(['body', 'edited_at', 'deleted_at', 'deleted_by']),
    );
    expect(columnNames(csCaseEvents)).toEqual(expect.arrayContaining(['type', 'actor_id', 'payload', 'occurred_at']));
    expect(columnNames(csCaseCommentAttachments)).toEqual(
      expect.arrayContaining(['cs_case_id', 'comment_id', 'file_id']),
    );
  });
});
