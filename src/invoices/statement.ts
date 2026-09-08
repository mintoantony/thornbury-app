import type { Customer, Invoice } from '../db.ts';
import { format, sum, type Pence } from '../shared/money.ts';
import { toDateKey } from '../shared/dates.ts';
import { displayTotal, totalFor } from './calc.ts';

export interface StatementInvoice {
  id: string;
  issued: string;
  paid: boolean;
  net: Pence;
  vat: Pence;
  total: Pence;
  formatted: { net: string; vat: string; total: string };
}

export interface StatementTotals {
  net: Pence;
  vat: Pence;
  invoiced: Pence;
  paid: Pence;
  outstanding: Pence;
}

export interface CustomerStatement {
  customer: Pick<Customer, 'id' | 'name' | 'address'>;
  // When the statement was produced: the instant we store, and the UK date the
  // customer will read at the top of it.
  generatedAt: string;
  generatedOn: string;
  invoices: StatementInvoice[];
  totals: StatementTotals;
  formatted: Record<keyof StatementTotals, string>;
}

export function statementFor(
  customer: Customer,
  allInvoices: Invoice[],
  generatedAt: Date = new Date(),
): CustomerStatement {
  const statementInvoices: StatementInvoice[] = allInvoices
    .filter((invoice) => invoice.customerId === customer.id)
    .sort((a, b) => a.issued.localeCompare(b.issued) || a.id.localeCompare(b.id))
    .map((invoice) => {
      const total = totalFor(invoice);
      return {
        id: invoice.id,
        issued: invoice.issued,
        paid: invoice.paid,
        ...total,
        formatted: displayTotal(total),
      };
    });

  const totals: StatementTotals = {
    net: sum(statementInvoices.map((invoice) => invoice.net)),
    vat: sum(statementInvoices.map((invoice) => invoice.vat)),
    invoiced: sum(statementInvoices.map((invoice) => invoice.total)),
    paid: sum(statementInvoices.filter((invoice) => invoice.paid).map((invoice) => invoice.total)),
    outstanding: sum(
      statementInvoices.filter((invoice) => !invoice.paid).map((invoice) => invoice.total),
    ),
  };

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      address: customer.address,
    },
    generatedAt: generatedAt.toISOString(),
    generatedOn: toDateKey(generatedAt),
    invoices: statementInvoices,
    totals,
    formatted: {
      net: format(totals.net),
      vat: format(totals.vat),
      invoiced: format(totals.invoiced),
      paid: format(totals.paid),
      outstanding: format(totals.outstanding),
    },
  };
}
