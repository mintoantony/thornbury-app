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
  assert.deepEqual(await response.json(), {
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
        vat: 3400,
        total: 248400,
      },
    ],
    totals: {
      net: 245000,
      vat: 3400,
      invoiced: 248400,
      paid: 0,
      outstanding: 248400,
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

test('the root serves the web app', async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await response.text(), /<script src="\/app\.js">/);
});

test('files outside public are not served', async () => {
  const response = await fetch(`${baseUrl}/package.json`);
  assert.equal(response.status, 404);
});

test('the service index lists the routes', async () => {
  const response = await fetch(`${baseUrl}/api`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.routes.includes('POST /work-orders'));
  assert.ok(body.routes.includes('POST /invoices/:id/pay'));
});

test('customer invoices carry their totals', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/invoices`);
  const [invoice] = await response.json();

  assert.equal(invoice.id, 'INV-9002');
  assert.equal(invoice.net, 245000);
  assert.equal(invoice.vat, 3400);
  assert.equal(invoice.total, 248400);
  assert.equal(invoice.display, '£2,484.00');
});

test('engineers are listed', async () => {
  const response = await fetch(`${baseUrl}/engineers`);
  const engineers = await response.json();

  assert.equal(engineers.length, 3);
  assert.equal(engineers[0].id, 'E-01');
});

const booking = {
  customerId: 'C-1002', requires: 'BACKFLOW', date: '2026-09-02', time: '10:00', durationMinutes: 45,
};

function book(body: unknown, raw = false) {
  return fetch(`${baseUrl}/work-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

test('a visit can be booked in UK local time', async () => {
  const before = await (await fetch(`${baseUrl}/work-orders`)).json();

  const response = await book(booking);
  const order = await response.json();

  assert.equal(response.status, 201);
  assert.match(order.id, /^W-\d+$/);
  assert.equal(order.requestedAt, '2026-09-02T09:00:00.000Z');
  assert.equal(order.address, 'Unit 6, Severnside Park, Avonmouth');
  assert.equal(order.status, 'QUEUED');

  const after = await (await fetch(`${baseUrl}/work-orders`)).json();
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.at(-1), order);
});

test('a booking is rejected when it is wrong', async () => {
  const cases: [unknown, string][] = [
    [{ ...booking, customerId: 'C-9999' }, 'no such customer'],
    [{ ...booking, requires: 'DIVING' }, 'requires must be one of METER, LEAK, BACKFLOW'],
    [{ ...booking, time: '9am' }, 'date must be YYYY-MM-DD and time HH:MM, UK local'],
    [{ ...booking, durationMinutes: 0 }, 'durationMinutes must be a positive whole number'],
  ];
  for (const [body, error] of cases) {
    const response = await book(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }

  const notJson = await book('not json', true);
  assert.equal(notJson.status, 400);
  assert.deepEqual(await notJson.json(), { error: 'body must be JSON' });
});

test('work orders reject other methods', async () => {
  const response = await fetch(`${baseUrl}/work-orders`, { method: 'DELETE' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
});

test('paying an invoice clears it from the outstanding balance', async () => {
  const before = await (await fetch(`${baseUrl}/customers/C-1003`)).json();
  assert.equal(before.outstanding, '£263.94');

  const response = await fetch(`${baseUrl}/invoices/INV-9003/pay`, { method: 'POST' });
  const paid = await response.json();

  assert.equal(response.status, 200);
  assert.equal(paid.paid, true);
  assert.equal(paid.total, 26394);

  const after = await (await fetch(`${baseUrl}/customers/C-1003`)).json();
  assert.equal(after.outstanding, '£0.00');

  const again = await fetch(`${baseUrl}/invoices/INV-9003/pay`, { method: 'POST' });
  assert.equal(again.status, 200);
});

test('paying an unknown invoice is a 404', async () => {
  const response = await fetch(`${baseUrl}/invoices/INV-0000/pay`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no such invoice' });
});
