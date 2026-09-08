import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customers, engineers, invoices, workOrders, type Invoice, type WorkOrder } from './db.ts';
import { totalFor, outstandingFor } from './invoices/calc.ts';
import { statementFor } from './invoices/statement.ts';
import { dispatch } from './scheduling/dispatch.ts';
import { slotsFor } from './scheduling/slots.ts';
import { ukLocalToUtc } from './shared/dates.ts';
import { format } from './shared/money.ts';

const PORT = Number(process.env.PORT ?? 4310);
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const SKILLS = ['METER', 'LEAK', 'BACKFLOW'];
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const ROUTES = [
  'GET /api',
  'GET /customers',
  'GET /customers/:id',
  'GET /customers/:id/invoices',
  'GET /customers/:id/statement',
  'GET /invoices/:id',
  'POST /invoices/:id/pay',
  'GET /engineers',
  'GET /work-orders',
  'POST /work-orders',
  'GET /dispatch',
  'GET /slots',
];

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function methodNotAllowed(res: ServerResponse, allow: string) {
  res.setHeader('allow', allow);
  return json(res, 405, { error: 'method not allowed' });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Anything under public/ with a known extension. The root is the app shell.
async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = resolve(PUBLIC_DIR, normalize(relative));
  const type = CONTENT_TYPES[extname(file)];
  if (!file.startsWith(PUBLIC_DIR) || !type) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': type });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function invoiceView(invoice: Invoice) {
  const totals = totalFor(invoice);
  return { ...invoice, ...totals, display: format(totals.total) };
}

function nextWorkOrderId(): string {
  const highest = workOrders.reduce((max, o) => Math.max(max, Number(o.id.slice(2)) || 0), 0);
  return `W-${highest + 1}`;
}

function bookWorkOrder(body: unknown): { status: number; body: unknown } {
  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { error: 'expected a JSON object' } };
  }
  const { customerId, requires, date, time, durationMinutes } = body as Record<string, unknown>;
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return { status: 400, body: { error: 'no such customer' } };
  if (typeof requires !== 'string' || !SKILLS.includes(requires)) {
    return { status: 400, body: { error: `requires must be one of ${SKILLS.join(', ')}` } };
  }
  if (!Number.isInteger(durationMinutes) || (durationMinutes as number) <= 0) {
    return { status: 400, body: { error: 'durationMinutes must be a positive whole number' } };
  }
  let requestedAt: Date;
  try {
    requestedAt = ukLocalToUtc(String(date), String(time));
  } catch {
    return { status: 400, body: { error: 'date must be YYYY-MM-DD and time HH:MM, UK local' } };
  }
  const order: WorkOrder = {
    id: nextWorkOrderId(),
    customerId: customer.id,
    address: customer.address,
    requires,
    requestedAt: requestedAt.toISOString(),
    durationMinutes: durationMinutes as number,
    status: 'QUEUED',
  };
  workOrders.push(order);
  return { status: 201, body: order };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method ?? 'GET';

  if (parts[0] === 'api' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, {
      service: 'Thornbury Systems billing and scheduling',
      version: '3.11.2',
      routes: ROUTES,
    });
  }

  if (parts[0] === 'customers') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    if (parts.length === 1) return json(res, 200, customers);
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    if (parts.length === 2) {
      return json(res, 200, { ...customer, outstanding: format(outstandingFor(customer.id, invoices)) });
    }
    if (parts.length === 3 && parts[2] === 'invoices') {
      return json(res, 200, invoices.filter((i) => i.customerId === customer.id).map(invoiceView));
    }
    if (parts.length === 3 && parts[2] === 'statement') {
      return json(res, 200, statementFor(customer, invoices));
    }
  }

  if (parts[0] === 'invoices' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'pay'))) {
    const paying = parts.length === 3;
    if (method !== (paying ? 'POST' : 'GET')) return methodNotAllowed(res, paying ? 'POST' : 'GET');
    const invoice = invoices.find((i) => i.id === parts[1]);
    if (!invoice) return json(res, 404, { error: 'no such invoice' });
    if (paying) invoice.paid = true;
    return json(res, 200, invoiceView(invoice));
  }

  if (parts[0] === 'engineers' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, engineers);
  }

  if (parts[0] === 'work-orders' && parts.length === 1) {
    if (method === 'GET') return json(res, 200, workOrders);
    if (method !== 'POST') return methodNotAllowed(res, 'GET, POST');
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return json(res, 400, { error: 'body must be JSON' });
    }
    const result = bookWorkOrder(body);
    return json(res, result.status, result.body);
  }

  if (parts[0] === 'dispatch' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, dispatch(workOrders));
  }

  if (parts[0] === 'slots' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, slotsFor(workOrders));
  }

  if (method === 'GET' && (await serveStatic(res, url.pathname))) return;

  return json(res, 404, { error: 'no such route', path: url.pathname });
}

export const server = createServer((req, res) => {
  handle(req, res).catch(() => json(res, 500, { error: 'server error' }));
});

if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(PORT, () => {
    console.log(`Thornbury Systems listening on http://localhost:${PORT}`);
  });
}
