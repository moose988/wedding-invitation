import test from 'node:test';
import assert from 'node:assert/strict';
import { sortEventsDraftsLast, paginateRows } from '../workspace-pagination.js';

test('drafts follow all other events across pages while each group keeps its chosen order', () => {
  const rows = [{ id: 'draft-late', status: 'draft', date: 5 }, { id: 'active-early', status: 'active', date: 2 }, { id: 'draft-early', status: 'draft', date: 1 }, { id: 'upcoming', status: 'upcoming', date: 4 }, { id: 'active-late', status: 'active', date: 3 }];
  const sorted = sortEventsDraftsLast(rows, 'date', Number);
  assert.deepEqual(sorted.map(row => row.id), ['upcoming', 'active-late', 'active-early', 'draft-late', 'draft-early']);
  assert.deepEqual(paginateRows(sorted, 2, 3).items.map(row => row.id), ['draft-late', 'draft-early']);
  assert.equal(rows[0].id, 'draft-late');
});
