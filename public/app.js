const app = document.getElementById('app');

const api = {
  async get(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
    return response.json();
  },
  async post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: response.ok, data: await response.json() };
  },
};

// Mirrors format() in src/shared/money.ts. Pence in, pounds out.
function pence(p) {
  const negative = p < 0;
  const abs = Math.abs(p);
  return `${negative ? '-' : ''}£${Math.floor(abs / 100).toLocaleString('en-GB')}.${String(abs % 100).padStart(2, '0')}`;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const ukDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});
// Accepts an ISO instant or a YYYY-MM-DD date. Shown as the UK calendar date.
function longDate(value) {
  return ukDate.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}

function home() {
  return `
  <section class="hero">
    <p class="eyebrow">Billing and job scheduling for UK water utilities</p>
    <h1>Thornbury Systems</h1>
    <p class="lede">Invoices with the VAT on them, one statement per customer, and a dispatch board that sends one van to one house.</p>
    <div class="cards">
      <a class="card" href="#/customers"><h2>Customers</h2><p>Accounts, invoices, outstanding balances and a printable statement.</p></a>
      <a class="card" href="#/operations"><h2>Operations</h2><p>Visits by engineer, anything left unassigned, and the booking form.</p></a>
    </div>
  </section>`;
}

async function customers() {
  const list = await api.get('/customers');
  return `
  <h1>Customers</h1>
  <div class="table-wrap"><table>
    <thead><tr><th>Account</th><th>Name</th><th>Type</th><th>Address</th><th>VAT registered</th></tr></thead>
    <tbody>${list.map((c) => `
      <tr>
        <td><a href="#/customers/${esc(c.id)}">${esc(c.id)}</a></td>
        <td><a href="#/customers/${esc(c.id)}">${esc(c.name)}</a></td>
        <td>${esc(c.accountType.toLowerCase())}</td>
        <td>${esc(c.address)}</td>
        <td>${c.vatRegistered ? 'Yes' : 'No'}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function account(id) {
  const [customer, invoices, statement] = await Promise.all([
    api.get(`/customers/${id}`),
    api.get(`/customers/${id}/invoices`),
    api.get(`/customers/${id}/statement`),
  ]);
  if (customer.error) return `<h1>No such customer</h1><p><a href="#/customers">Back to customers</a></p>`;

  const invoiceRows = invoices.map((i) => `
    <tr>
      <td>${esc(i.id)}</td>
      <td>${longDate(i.issued)}</td>
      <td>${esc(i.source.toLowerCase().replace('_', ' '))}</td>
      <td class="num">${pence(i.net)}</td>
      <td class="num">${pence(i.vat)}</td>
      <td class="num">${pence(i.total)}</td>
      <td>${i.paid ? '<span class="tag ok">Paid</span>' : '<span class="tag due">Outstanding</span>'}</td>
      <td>${i.paid ? '' : `<button class="btn small" data-pay="${esc(i.id)}">Mark paid</button>`}</td>
    </tr>`).join('');

  const statementRows = statement.invoices.map((i) => `
    <tr>
      <td>${esc(i.id)}</td>
      <td>${longDate(i.issued)}</td>
      <td class="num">${pence(i.net)}</td>
      <td class="num">${pence(i.vat)}</td>
      <td class="num">${pence(i.total)}</td>
      <td>${i.paid ? 'Paid' : 'Outstanding'}</td>
    </tr>`).join('');

  return `
  <p class="crumbs"><a href="#/customers">Customers</a> / ${esc(customer.id)}</p>
  <header class="account-head">
    <div>
      <h1>${esc(customer.name)}</h1>
      <p class="muted">${esc(customer.address)} · ${esc(customer.accountType.toLowerCase())}${customer.vatRegistered ? ' · VAT registered' : ''}</p>
    </div>
    <div class="balance"><span class="label">Outstanding</span><strong>${esc(customer.outstanding)}</strong></div>
  </header>

  <section>
    <h2>Invoices</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>Issued</th><th>Source</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${invoiceRows}</tbody>
    </table></div>
  </section>

  <section id="statement">
    <div class="statement-head"><h2>Statement</h2><button class="btn" data-print>Print statement</button></div>
    <div class="sheet">
      <div class="sheet-top">
        <div><strong>Thornbury Systems</strong><br>Statement of account</div>
        <div class="right">${esc(statement.customer.name)}<br>${esc(statement.customer.address)}<br>Account ${esc(statement.customer.id)}<br>${longDate(new Date().toISOString())}</div>
      </div>
      <table>
        <thead><tr><th>Invoice</th><th>Issued</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${statementRows}</tbody>
      </table>
      <dl class="totals">
        <dt>Net</dt><dd>${pence(statement.totals.net)}</dd>
        <dt>VAT</dt><dd>${pence(statement.totals.vat)}</dd>
        <dt>Invoiced</dt><dd>${pence(statement.totals.invoiced)}</dd>
        <dt>Paid</dt><dd>${pence(statement.totals.paid)}</dd>
        <dt class="grand">Outstanding</dt><dd class="grand">${pence(statement.totals.outstanding)}</dd>
      </dl>
    </div>
  </section>`;
}

async function operations() {
  const [plan, orders, slots, customerList, engineers] = await Promise.all([
    api.get('/dispatch'),
    api.get('/work-orders'),
    api.get('/slots'),
    api.get('/customers'),
    api.get('/engineers'),
  ]);
  const customerById = Object.fromEntries(customerList.map((c) => [c.id, c]));
  const slotById = Object.fromEntries(slots.map((s) => [s.workOrderId, s]));
  const name = (customerId) => esc(customerById[customerId]?.name ?? customerId);

  const engineerCards = engineers.map((e) => {
    const visits = plan.visits.filter((v) => v.engineerId === e.id);
    const rows = visits.length ? visits.map((v) => `
      <div class="visit">
        <div class="when"><strong>${longDate(v.startsAt)}</strong><span>${esc(v.window)}</span></div>
        <div>
          <strong>${esc(v.address)}</strong><br>
          <span class="muted">${name(v.customerId)} · ${esc(v.requires.join(' + '))} · ${esc(v.durationMinutes)} min · ${esc(v.workOrderIds.join(', '))}</span>
        </div>
      </div>`).join('') : '<p class="muted">Nothing planned.</p>';
    return `<article class="engineer"><h3>${esc(e.name)} <span class="muted">${esc(e.id)} · ${esc(e.skills.join(', '))}</span></h3>${rows}</article>`;
  }).join('');

  const unassigned = plan.unassigned.length ? `<ul class="unassigned">${plan.unassigned.map((u) => `
    <li>
      <strong>${esc(u.workOrderId)}</strong> ${esc(u.address)} · ${esc(u.requires)} · ${longDate(u.requestedAt)} ${esc(slotById[u.workOrderId]?.window ?? '')}<br>
      <span class="why">${u.reason === 'NO_ENGINEER_FREE' ? 'No engineer free' : 'No engineer with the skill'}: ${esc(u.detail)}</span>
    </li>`).join('')}</ul>` : '<p class="muted">Everything on the queue has an engineer.</p>';

  const queueRows = orders.map((o) => `
    <tr>
      <td>${esc(o.id)}</td>
      <td>${name(o.customerId)}</td>
      <td>${esc(o.address)}</td>
      <td>${esc(o.requires)}</td>
      <td>${esc(slotById[o.id]?.date ?? '')}</td>
      <td>${esc(slotById[o.id]?.window ?? '')}</td>
      <td>${esc(o.status.toLowerCase())}</td>
    </tr>`).join('');

  return `
  <h1>Operations</h1>

  <section>
    <h2>Visits</h2>
    <div class="engineers">${engineerCards}</div>
  </section>

  <section>
    <h2>Unassigned</h2>
    ${unassigned}
  </section>

  <section class="two-col">
    <div>
      <h2>Queue</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Address</th><th>Skill</th><th>Date</th><th>Window</th><th>Status</th></tr></thead>
        <tbody>${queueRows}</tbody>
      </table></div>
    </div>
    <div>
      <h2>Book a visit</h2>
      <form id="book" class="form">
        <label>Customer
          <select name="customerId" required>${customerList.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label>Skill
          <select name="requires"><option>METER</option><option>LEAK</option><option>BACKFLOW</option></select>
        </label>
        <label>Date (UK)<input type="date" name="date" value="2026-09-02" required></label>
        <label>Time (UK)<input type="time" name="time" value="10:00" required></label>
        <label>Duration (minutes)<input type="number" name="durationMinutes" min="15" step="15" value="60" required></label>
        <button class="btn" type="submit">Book</button>
        <p id="book-result" class="muted" role="status"></p>
      </form>
    </div>
  </section>`;
}

const routes = [
  [/^#\/?$/, home],
  [/^#\/customers\/?$/, customers],
  [/^#\/customers\/([^/]+)$/, account],
  [/^#\/operations\/?$/, operations],
];

async function render() {
  try {
    const hash = location.hash || '#/';
    for (const [pattern, view] of routes) {
      const match = pattern.exec(hash);
      if (match) {
        app.innerHTML = await view(...match.slice(1));
        return;
      }
    }
    app.innerHTML = '<h1>Not found</h1><p><a href="#/">Home</a></p>';
  } catch {
    // A failed request used to leave the screen blank. Say so instead.
    app.innerHTML = '<h1>Sorry</h1><p>Something went wrong loading this page.</p>';
  }
}

app.addEventListener('click', async (event) => {
  const pay = event.target.closest('[data-pay]');
  if (pay) {
    pay.disabled = true;
    await api.post(`/invoices/${pay.dataset.pay}/pay`);
    await render();
    return;
  }
  if (event.target.closest('[data-print]')) window.print();
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('#book');
  if (!form) return;
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  body.durationMinutes = Number(body.durationMinutes);
  const { ok, data } = await api.post('/work-orders', body);
  if (!ok) {
    const result = document.getElementById('book-result');
    result.textContent = data.error;
    result.className = 'error';
    return;
  }
  await render();
  const result = document.getElementById('book-result');
  result.textContent = `Booked ${data.id}.`;
  result.className = 'muted';
});

window.addEventListener('hashchange', render);
render();
