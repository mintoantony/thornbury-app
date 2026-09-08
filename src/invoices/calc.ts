import { format, percentOf, sum, type Pence } from '../shared/money.ts';
import type { Invoice, LineItem } from '../db.ts';

export interface InvoiceTotal {
  net: Pence;
  vat: Pence;
  total: Pence;
}

const STANDARD_VAT_PERCENT = 20;

export function lineTotal(line: LineItem): Pence {
  return line.quantity * line.unitPence;
}

// Paper invoices carried a printing and postage charge that the web product
// never had. Kept so historic invoices still reconcile.
function legacySurcharge(invoice: Invoice): Pence {
  if (invoice.source === 'LEGACY_PAPER') {
    return 150;
  }
  return 0;
}

export function totalFor(invoice: Invoice): InvoiceTotal {
  const net = sum(invoice.lines.map(lineTotal)) + legacySurcharge(invoice);
  // Every line is standard rated, whatever its kind and whoever the account
  // belongs to, and so is the legacy postage surcharge.
  const vat = percentOf(net, STANDARD_VAT_PERCENT);
  return { net, vat, total: net + vat };
}

// The pounds and pence the customer reads, for each part of the total. Anything
// customer facing wants VAT broken out, not just rolled into the total.
export function displayTotal(total: InvoiceTotal): Record<keyof InvoiceTotal, string> {
  return {
    net: format(total.net),
    vat: format(total.vat),
    total: format(total.total),
  };
}

export function outstandingFor(customerId: string, all: Invoice[]): Pence {
  return sum(
    all.filter((i) => i.customerId === customerId && !i.paid).map((i) => totalFor(i).total),
  );
}
