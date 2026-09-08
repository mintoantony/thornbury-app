import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';

let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('customer statement combines invoices and account totals', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/statement`);

  assert.equal(response.status, 200);
  const { generatedAt, generatedOn, ...statement } = await response.json();
  assert.match(generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(generatedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(statement, {
    customer: {
      id: 'C-1002',
      name: 'Trelawney Foods Ltd',
      address: 'Unit 6, Severnside Park, Avonmouth',
    },
    invoices: [
      {
        id: 'INV-9002',
        issued: '2026-07-01',
        paid: false,
        net: 245000,
        vat: 49000,
        total: 294000,
        formatted: { net: '£2,450.00', vat: '£490.00', total: '£2,940.00' },
      },
    ],
    totals: {
      net: 245000,
      vat: 49000,
      invoiced: 294000,
      paid: 0,
      outstanding: 294000,
    },
    formatted: {
      net: '£2,450.00',
      vat: '£490.00',
      invoiced: '£2,940.00',
      paid: '£0.00',
      outstanding: '£2,940.00',
    },
  });
});

test('customer statement reports an unknown customer', async () => {
  const response = await fetch(`${baseUrl}/customers/unknown/statement`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no such customer' });
});

test('customer statement rejects non-GET requests', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/statement`, {
    method: 'POST',
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'method not allowed' });
});

test('an invoice carries its VAT, in pence and in pounds', async () => {
  const response = await fetch(`${baseUrl}/invoices/INV-9002`);

  assert.equal(response.status, 200);
  const invoice = await response.json();
  assert.equal(invoice.net, 245000);
  assert.equal(invoice.vat, 49000);
  assert.equal(invoice.total, 294000);
  assert.deepEqual(invoice.formatted, { net: '£2,450.00', vat: '£490.00', total: '£2,940.00' });
  assert.equal(invoice.display, '£2,940.00');
});

test("a customer's invoice list carries VAT on every invoice", async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/invoices`);

  assert.equal(response.status, 200);
  const [invoice] = await response.json();
  assert.equal(invoice.id, 'INV-9002');
  assert.equal(invoice.vat, 49000);
  assert.equal(invoice.formatted.vat, '£490.00');
});

test('the outstanding balance includes VAT', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002`);

  assert.equal(response.status, 200);
  const customer = await response.json();
  assert.equal(customer.outstanding, '£2,940.00');
});
