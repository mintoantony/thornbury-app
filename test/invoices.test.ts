import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalFor, lineTotal, outstandingFor, displayTotal } from '../src/invoices/calc.ts';
import { invoices, type Invoice } from '../src/db.ts';

test('line totals multiply quantity by unit price', () => {
  assert.equal(lineTotal({ description: 'x', quantity: 41, unitPence: 218, kind: 'SUPPLY' }), 8938);
});

test('invoice totals are calculated for every invoice', () => {
  for (const invoice of invoices) {
    totalFor(invoice);
  }
});

test('outstanding balance ignores paid invoices', () => {
  const owed = outstandingFor('C-1001', invoices);
  assert.equal(owed, 0);
});

test('commercial invoice totals', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9002')!;
  assert.deepEqual(totalFor(invoice), {
    net: 245000,
    vat: 49000,
    total: 294000,
  });
});

test('supply lines are vatable, not just engineer work', () => {
  const supplyOnly: Invoice = {
    id: 'INV-0002',
    customerId: 'C-1001',
    issued: '2026-07-01',
    source: 'WEB',
    paid: false,
    lines: [{ description: 'Metered supply', quantity: 10, unitPence: 100, kind: 'SUPPLY' }],
  };
  assert.deepEqual(totalFor(supplyOnly), { net: 1000, vat: 200, total: 1200 });
});

test('outstanding balance includes VAT', () => {
  assert.equal(outstandingFor('C-1002', invoices), 294000);
});

test('legacy paper invoices carry the postage surcharge, and VAT on it', () => {
  const paper: Invoice = {
    id: 'INV-0001',
    customerId: 'C-1001',
    issued: '2018-03-01',
    source: 'LEGACY_PAPER',
    paid: true,
    lines: [{ description: 'Metered supply', quantity: 10, unitPence: 100, kind: 'SUPPLY' }],
  };
  assert.deepEqual(totalFor(paper), { net: 1150, vat: 230, total: 1380 });
});

test('totals are formatted for the customer', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9002')!;
  assert.deepEqual(displayTotal(totalFor(invoice)), {
    net: '£2,450.00',
    vat: '£490.00',
    total: '£2,940.00',
  });
});
