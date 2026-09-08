import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Customer, Invoice } from '../src/db.ts';
import { statementFor } from '../src/invoices/statement.ts';

test('statement orders invoices and separates paid from outstanding totals', () => {
  const customer: Customer = {
    id: 'C-2001',
    name: 'Test Customer',
    address: '1 Test Road',
    accountType: 'COMMERCIAL',
    vatRegistered: true,
  };
  const invoices: Invoice[] = [
    {
      id: 'INV-2',
      customerId: customer.id,
      issued: '2026-07-01',
      source: 'WEB',
      paid: false,
      lines: [
        { description: 'Engineer visit', quantity: 1, unitPence: 100, kind: 'SERVICE' },
      ],
    },
    {
      id: 'INV-1',
      customerId: customer.id,
      issued: '2026-04-01',
      source: 'WEB',
      paid: true,
      lines: [
        { description: 'Metered supply', quantity: 2, unitPence: 100, kind: 'SUPPLY' },
      ],
    },
  ];

  // Late on a summer evening: already tomorrow in the UK.
  const generatedAt = new Date('2026-09-02T23:30:00Z');

  assert.deepEqual(statementFor(customer, invoices, generatedAt), {
    customer: {
      id: 'C-2001',
      name: 'Test Customer',
      address: '1 Test Road',
    },
    generatedAt: '2026-09-02T23:30:00.000Z',
    generatedOn: '2026-09-03',
    invoices: [
      {
        id: 'INV-1', issued: '2026-04-01', paid: true, net: 200, vat: 40, total: 240,
        formatted: { net: '£2.00', vat: '£0.40', total: '£2.40' },
      },
      {
        id: 'INV-2', issued: '2026-07-01', paid: false, net: 100, vat: 20, total: 120,
        formatted: { net: '£1.00', vat: '£0.20', total: '£1.20' },
      },
    ],
    totals: {
      net: 300,
      vat: 60,
      invoiced: 360,
      paid: 240,
      outstanding: 120,
    },
    formatted: {
      net: '£3.00',
      vat: '£0.60',
      invoiced: '£3.60',
      paid: '£2.40',
      outstanding: '£1.20',
    },
  });
});

test('statement for a customer with no invoices is empty, not missing', () => {
  const customer: Customer = {
    id: 'C-2002',
    name: 'New Customer',
    address: '2 Test Road',
    accountType: 'DOMESTIC',
    vatRegistered: false,
  };
  const statement = statementFor(customer, [], new Date('2026-01-15T10:00:00Z'));
  assert.deepEqual(statement.invoices, []);
  assert.deepEqual(statement.totals, { net: 0, vat: 0, invoiced: 0, paid: 0, outstanding: 0 });
  assert.equal(statement.formatted.outstanding, '£0.00');
  assert.equal(statement.generatedOn, '2026-01-15');
});
