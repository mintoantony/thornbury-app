import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// public/app.js runs in a browser and there is no DOM here, so these read it as text.
const source = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');

test('a failed request shows a message instead of leaving the screen blank', () => {
  assert.match(source, /if \(!response\.ok\) throw/);
  assert.match(source, /Something went wrong loading this page\./);
});

test('every interpolated API value in the web app is escaped', () => {
  const unescaped = [
    '${c.id}',
    '${c.accountType.toLowerCase()}',
    '${customer.id}',
    '${customer.outstanding}',
    '${customer.accountType.toLowerCase()}',
    '${statement.customer.id}',
    '${i.id}',
    '${o.id}',
    '${o.requires}',
    '${o.status.toLowerCase()}',
    '${u.requires}',
    '${u.workOrderId}',
    '${v.window}',
    '${v.requires.join',
    '${e.id}',
    '${e.skills.join',
    "${slotById[o.id]?.date ?? ''}",
    "${slotById[o.id]?.window ?? ''}",
  ];

  for (const expression of unescaped) {
    assert.ok(!source.includes(expression), `${expression} reaches the DOM unescaped`);
  }
});
