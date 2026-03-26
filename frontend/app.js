// API base URL: set in build or use same origin when served with API
const API = window.API_BASE_URL || '';

async function api(path, options = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    let errMsg = res.statusText;
    try {
      const err = JSON.parse(text);
      if (err && err.error) errMsg = err.error;
    } catch (_) {
      if (text && text.length < 200) errMsg = text;
      else if (text) errMsg = 'Server returned non-JSON (check API URL and CORS)';
    }
    throw new Error(errMsg);
  }
  if (res.status === 204) return null;
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    throw new Error('Invalid JSON from server. Check API URL and that the backend is running.');
  }
}

let state = {
  products: [],
  inventory: [],
  sales: [],
  summary: {
    totalSpend: 0,
    totalRevenue: 0,
    netProfit: 0,
    computedTotalSpend: 0,
    computedTotalRevenue: 0,
    computedNetProfit: 0,
    overridesActive: false,
    latestOverride: null,
  },
  salesClientFilter: '',
};

async function loadAll() {
  try {
    const [products, inventory, sales, summary] = await Promise.all([
      api('/products'),
      api('/inventory'),
      api('/sales'),
      api('/summary'),
    ]);
    state.products = products || [];
    state.inventory = inventory || [];
    state.sales = sales || [];
    state.summary =
      summary || {
        totalSpend: 0,
        totalRevenue: 0,
        netProfit: 0,
        computedTotalSpend: 0,
        computedTotalRevenue: 0,
        computedNetProfit: 0,
        overridesActive: false,
        latestOverride: null,
      };
    render();
  } catch (e) {
    console.error(e);
    document.getElementById('spendBody').innerHTML = `<tr><td colspan="7" class="error">Failed to load: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getComputedSpendFromInventory() {
  const items = (state.inventory || []).filter((i) => toNumber(i.quantity) > 0);
  return items.reduce((sum, r) => sum + toNumber(r.price) * toNumber(r.quantity), 0);
}

function getDisplayTotalSpend() {
  const s = state.summary || {};
  if (s.totalSpend != null && s.totalSpend !== undefined) return toNumber(s.totalSpend);
  if (s.computedTotalSpend != null && s.computedTotalSpend !== undefined) {
    return toNumber(s.computedTotalSpend);
  }
  return getComputedSpendFromInventory();
}

function getDisplayTotalRevenue() {
  const s = state.summary || {};
  if (s.totalRevenue != null && s.totalRevenue !== undefined) return toNumber(s.totalRevenue);
  if (s.computedTotalRevenue != null && s.computedTotalRevenue !== undefined) {
    return toNumber(s.computedTotalRevenue);
  }
  return toNumber(0);
}

function render() {
  renderSpendTable();
  renderSalesTable();
  renderSummary();
}

function renderSpendTable() {
  const tbody = document.getElementById('spendBody');
  const items = (state.inventory || []).filter((i) => (i.quantity || 0) > 0);
  const statusClassByStatus = {
    Delivered: 'status-delivered',
    Shipped: 'status-shipped',
    Processing: 'status-processing',
    Scammed: 'status-scammed',
  };

  // Group by order date: prefer purchase_date, fall back to created_at
  const groups = {};
  items.forEach((r) => {
    const rawDate = r.purchase_date || r.created_at;
    if (!rawDate) return;
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return;
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const orderKeys = Object.keys(groups).sort(); // oldest first; reverse if you want newest first

  const totalSpend = getDisplayTotalSpend();

  tbody.innerHTML = orderKeys
    .map((dateKey, idx) => {
      const orderId = `order-${idx}`;
      const rows = groups[dateKey];
      const orderTotal = rows.reduce(
        (sum, r) => sum + toNumber(r.price) * toNumber(r.quantity),
        0,
      );
      const orderLabel = (() => {
        const d = new Date(rows[0].purchase_date || rows[0].created_at);
        if (Number.isNaN(d.getTime())) return dateKey;
        return d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      })();
      const summaryText = `${rows.length} product${rows.length === 1 ? '' : 's'}`;
      const orderStatus = rows.find((r) => r.status)?.status || '';

      const detailsRows = rows
        .map((r) => {
          const rawDate = r.purchase_date || r.created_at;
          let rowDateKey = '';
          if (rawDate) {
            const d = new Date(rawDate);
            if (!Number.isNaN(d.getTime())) {
              rowDateKey = d.toISOString().slice(0, 10);
            }
          }
          const isLegacyCost =
            (r.unit_cost == null || r.unit_cost === '') && toNumber(r.quantity) > 0;
          const lockAmount = toNumber(
            r.catalog_price != null && r.catalog_price !== '' ? r.catalog_price : r.price,
          );
          return `
              <tr class="${statusClassByStatus[orderStatus] || ''}">
                <td>${escapeHtml(r.cat_no || '-')}</td>
                <td>${escapeHtml(r.product_name || '')}</td>
                <td>${escapeHtml(r.spec || '')}</td>
                <td class="num">${formatMoney(r.price)}${
            isLegacyCost
              ? '<span class="cost-legacy-tag" title="Cost follows catalog until you lock it">catalog</span>'
              : ''
          }</td>
                <td class="num">${r.quantity}</td>
                <td class="num">${formatMoney(toNumber(r.price) * toNumber(r.quantity))}</td>
                <td>
                  <button type="button" class="btn btn-small" data-edit-row-id="${r.id}">Edit</button>
                  ${
            isLegacyCost
              ? `<button type="button" class="btn btn-small" data-lock-unit-cost="${r.id}" data-lock-amount="${lockAmount}" title="Freeze this line at the current catalog unit cost">Lock cost</button>`
              : ''
          }
                  <button type="button" class="btn btn-small btn-delete"
                    data-inventory-id="${r.id}">
                    Delete
                  </button>
                  <span class="row-date-editor" data-editor-for-row="${r.id}" style="display:none;">
                    <input type="date" data-date-input-for-row="${r.id}" value="${rowDateKey}" />
                    <button type="button" class="btn btn-small btn-primary" data-save-row-id="${r.id}">Save</button>
                    <button type="button" class="btn btn-small" data-cancel-row-id="${r.id}">Cancel</button>
                  </span>
                </td>
              </tr>`;
        })
        .join('');

      return `
        <tr class="order-row ${statusClassByStatus[orderStatus] || ''}" data-order-id="${orderId}" data-order-date-key="${dateKey}">
          <td>
            <button type="button" class="btn btn-small toggle-order" data-order-id="${orderId}">▼</button>
            ${escapeHtml(orderLabel)}
          </td>
          <td>
            <select data-order-status-date-key="${dateKey}">
              <option value="" ${!orderStatus ? 'selected' : ''}>—</option>
              <option value="Delivered" ${orderStatus === 'Delivered' ? 'selected' : ''}>Delivered</option>
              <option value="Shipped" ${orderStatus === 'Shipped' ? 'selected' : ''}>Shipped</option>
              <option value="Processing" ${orderStatus === 'Processing' ? 'selected' : ''}>Processing</option>
              <option value="Scammed" ${orderStatus === 'Scammed' ? 'selected' : ''}>Scammed</option>
            </select>
          </td>
          <td>${escapeHtml(summaryText)}</td>
          <td class="num">${formatMoney(orderTotal)}</td>
          <td></td>
        </tr>
        <tr class="order-details" data-order-id="${orderId}" style="display:none;">
          <td colspan="5">
            <table class="nested-table">
              <thead>
                <tr>
                  <th>Cat.No</th>
                  <th>Product</th>
                  <th>Spec</th>
                  <th class="num">Cost</th>
                  <th class="num">Qty</th>
                  <th class="num">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${detailsRows}
              </tbody>
            </table>
          </td>
        </tr>`;
    })
    .join('');

  document.getElementById('totalSpend').textContent = formatMoney(totalSpend);

  // Toggle handlers
  tbody.querySelectorAll('.toggle-order').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.orderId;
      const row = tbody.querySelector(`.order-details[data-order-id="${id}"]`);
      if (!row) return;
      const hidden = row.style.display === 'none';
      row.style.display = hidden ? '' : 'none';
      btn.textContent = hidden ? '▲' : '▼';
    });
  });

  // Delete handlers for nested rows
  tbody.querySelectorAll('button[data-inventory-id]').forEach((btn) => {
    btn.addEventListener('click', () => deletePurchase(btn.dataset.inventoryId));
  });

  tbody.querySelectorAll('button[data-lock-unit-cost]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.lockUnitCost;
      const amount = toNumber(btn.dataset.lockAmount);
      if (!id || !Number.isFinite(amount)) return;
      try {
        await api('/inventory', {
          method: 'PUT',
          body: JSON.stringify({ id, unit_cost: amount }),
        });
        await loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Per-row order date edit handlers
  tbody.querySelectorAll('button[data-edit-row-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.editRowId;
      const editor = tbody.querySelector(`.row-date-editor[data-editor-for-row="${id}"]`);
      if (!editor) return;
      editor.style.display = editor.style.display === 'none' ? '' : 'none';
    });
  });

  tbody.querySelectorAll('button[data-cancel-row-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cancelRowId;
      const editor = tbody.querySelector(`.row-date-editor[data-editor-for-row="${id}"]`);
      if (!editor) return;
      editor.style.display = 'none';
    });
  });

  tbody.querySelectorAll('button[data-save-row-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveRowId;
      const editor = tbody.querySelector(`.row-date-editor[data-editor-for-row="${id}"]`);
      const input = tbody.querySelector(`input[data-date-input-for-row="${id}"]`);
      if (!editor || !input || !input.value) {
        alert('Select a valid order date.');
        return;
      }
      const newDate = input.value; // YYYY-MM-DD
      const row = items.find((r) => r.id === id);
      if (!row) {
        alert('Could not find this purchase row.');
        return;
      }
      try {
        await api('/inventory', {
          method: 'PUT',
          body: JSON.stringify({
            id: row.id,
            quantity: row.quantity,
            purchase_date: newDate,
          }),
        });
        editor.style.display = 'none';
        await loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  tbody.querySelectorAll('select[data-order-status-date-key]').forEach((select) => {
    select.addEventListener('change', async () => {
      const dateKey = select.dataset.orderStatusDateKey;
      if (!dateKey) return;
      const nextStatus = select.value || null;
      const groupRows = groups[dateKey] || [];
      if (groupRows.length === 0) return;
      try {
        await Promise.all(
          groupRows.map((row) =>
            api('/inventory', {
              method: 'PUT',
              body: JSON.stringify({
                id: row.id,
                quantity: row.quantity,
                purchase_date: row.purchase_date,
                status: nextStatus,
              }),
            }),
          ),
        );
        await loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function deletePurchase(inventoryId) {
  try {
    await api('/inventory', {
      method: 'PUT',
      body: JSON.stringify({ id: inventoryId, quantity: 0 }),
    });
    await loadAll();
  } catch (e) {
    console.error(e);
  }
}

function openPurchaseModal() {
  const productSelect = document.getElementById('purchaseProduct');
  const specSelect = document.getElementById('purchaseSpec');
  productSelect.innerHTML = '<option value="">Select product</option>' + (state.products || []).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  specSelect.innerHTML = '<option value="">Select spec</option>';
  document.getElementById('purchaseForm').reset();
  const dateInput = document.getElementById('purchaseDate');
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }
  document.getElementById('purchaseModal').setAttribute('aria-hidden', 'false');
}

function syncPurchaseUnitCostFromSpec() {
  const productId = document.getElementById('purchaseProduct').value;
  const specId = document.getElementById('purchaseSpec').value;
  const input = document.getElementById('purchaseUnitCost');
  if (!input) return;
  if (!productId || !specId) {
    input.value = '';
    return;
  }
  const product = state.products.find((p) => p.id === productId);
  const spec = product?.specs?.find((s) => s.id === specId);
  if (spec) input.value = spec.price;
}

function updatePurchaseSpecDropdown() {
  const productId = document.getElementById('purchaseProduct').value;
  const specSelect = document.getElementById('purchaseSpec');
  specSelect.innerHTML = '<option value="">Select spec</option>';
  if (!productId) return;
  const product = state.products.find((p) => p.id === productId);
  if (product && product.specs) {
    product.specs.forEach((s) => {
      specSelect.appendChild(new Option(`${s.spec} — ${formatMoney(s.price)}`, s.id));
    });
  }
  syncPurchaseUnitCostFromSpec();
}

function closePurchaseModal() {
  document.getElementById('purchaseModal').setAttribute('aria-hidden', 'true');
}

document.getElementById('addPurchase').addEventListener('click', openPurchaseModal);
document.getElementById('closePurchaseModal').addEventListener('click', closePurchaseModal);
document.getElementById('cancelPurchase').addEventListener('click', closePurchaseModal);
document.getElementById('purchaseProduct').addEventListener('change', updatePurchaseSpecDropdown);
document.getElementById('purchaseSpec').addEventListener('change', syncPurchaseUnitCostFromSpec);

document.getElementById('purchaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const product_id = document.getElementById('purchaseProduct').value;
  const product_spec_id = document.getElementById('purchaseSpec').value;
  const addQty = Math.max(0, parseInt(document.getElementById('purchaseQty').value, 10) || 0);
  const purchase_date = document.getElementById('purchaseDate').value || null;
  const unitCostRaw = document.getElementById('purchaseUnitCost')?.value;
  if (!product_id || !product_spec_id) return;
  if (addQty <= 0) {
    alert('Enter a quantity greater than 0.');
    return;
  }
  const payload = { product_id, product_spec_id, quantity: addQty, purchase_date };
  if (unitCostRaw != null && String(unitCostRaw).trim() !== '') {
    payload.unit_cost = parseFloat(unitCostRaw);
  }
  try {
    await api('/inventory', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    closePurchaseModal();
    await loadAll();
  } catch (err) {
    alert(err.message);
  }
});

function renderSalesTable() {
  const tbody = document.getElementById('salesBody');
  const filterSelect = document.getElementById('salesClientFilter');

  // Build client filter options
  const allSales = state.sales || [];
  if (filterSelect) {
    const seen = new Set();
    const clients = [];
    allSales.forEach((s) => {
      const raw = (s.client_name || '').trim();
      const key = raw || '(none)';
      if (!seen.has(key)) {
        seen.add(key);
        clients.push(key);
      }
    });
    clients.sort((a, b) => a.localeCompare(b));
    const current = state.salesClientFilter || '';
    filterSelect.innerHTML =
      '<option value="">All</option>' +
      clients.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (current) filterSelect.value = current;
  }

  const filtered = allSales
    .filter((s) => {
      if (!state.salesClientFilter) return true;
      const key = (s.client_name || '(none)').trim() || '(none)';
      return key === state.salesClientFilter;
    });

  let totalRevenue = 0;
  filtered.forEach((s) => {
    totalRevenue += Number(s.revenue) || 0;
  });

  const groups = {};
  filtered.forEach((s) => {
    const clientKey = (s.client_name || '(none)').trim() || '(none)';
    if (!groups[clientKey]) groups[clientKey] = [];
    groups[clientKey].push(s);
  });
  const clientKeys = Object.keys(groups).sort((a, b) => {
    const maxA = Math.max(...groups[a].map((s) => new Date(s.created_at || 0).getTime()));
    const maxB = Math.max(...groups[b].map((s) => new Date(s.created_at || 0).getTime()));
    return maxB - maxA;
  });
  tbody.innerHTML = clientKeys
    .map((clientKey, idx) => {
      const groupId = `client-${idx}`;
      const rows = groups[clientKey]
        .slice()
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      const groupRevenue = rows.reduce((sum, s) => sum + (Number(s.revenue) || 0), 0);
      const detailsRows = rows
        .map((s) => {
          let dateLabel = '';
          if (s.created_at) {
            const d = new Date(s.created_at);
            if (!Number.isNaN(d.getTime())) {
              dateLabel = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            }
          }
          return `
            <tr>
              <td>${escapeHtml(dateLabel || '-')}</td>
              <td>${escapeHtml((s.client_name || '').trim() || '—')}</td>
              <td>${escapeHtml(s.product_name || '')} ${escapeHtml(s.spec || '')}</td>
              <td class="num">${s.quantity_sold}</td>
              <td class="num">${formatMoney(s.sell_price_per_sub)}</td>
              <td class="num">${formatMoney(s.revenue)}</td>
              <td>
                <button type="button" class="btn btn-small" data-edit-sale-id="${s.id}">Edit</button>
                <button type="button" class="btn btn-small btn-delete" data-sale-id="${s.id}">Delete</button>
              </td>
            </tr>`;
        })
        .join('');

      return `
        <tr class="order-row" data-sales-group-id="${groupId}">
          <td>
            <button type="button" class="btn btn-small toggle-sales-group" data-sales-group-id="${groupId}">▼</button>
            ${escapeHtml(clientKey === '(none)' ? '—' : clientKey)}
          </td>
          <td>${rows.length} sale${rows.length === 1 ? '' : 's'}</td>
          <td></td>
          <td></td>
          <td></td>
          <td class="num">${formatMoney(groupRevenue)}</td>
          <td></td>
        </tr>
        <tr class="order-details" data-sales-group-id="${groupId}" style="display:none;">
          <td colspan="7">
            <table class="nested-table">
              <thead>
                <tr>
                  <th>Sale date</th>
                  <th>Client</th>
                  <th>Item</th>
                  <th>Qty sold</th>
                  <th>Sell price</th>
                  <th>Revenue</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${detailsRows}</tbody>
            </table>
          </td>
        </tr>`;
    })
    .join('');
  document.getElementById('totalRevenue').textContent = formatMoney(totalRevenue);
  tbody.querySelectorAll('.toggle-sales-group').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.salesGroupId;
      const row = tbody.querySelector(`.order-details[data-sales-group-id="${id}"]`);
      if (!row) return;
      const hidden = row.style.display === 'none';
      row.style.display = hidden ? '' : 'none';
      btn.textContent = hidden ? '▲' : '▼';
    });
  });
  tbody.querySelectorAll('[data-sale-id]').forEach((btn) => {
    btn.addEventListener('click', () => deleteSale(btn.dataset.saleId));
  });
  tbody.querySelectorAll('[data-edit-sale-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sale = allSales.find((s) => s.id === btn.dataset.editSaleId);
      if (sale) openEditSaleModal(sale);
    });
  });
}

async function deleteSale(id) {
  try {
    await api(`/sales/${id}`, { method: 'DELETE' });
    await loadAll();
  } catch (e) {
    console.error(e);
  }
}

function renderSummary() {
  const s = state.summary;
  const totalSpend = getDisplayTotalSpend();
  const totalRevenue = getDisplayTotalRevenue();
  const netProfit = totalRevenue - totalSpend;

  document.getElementById('sumSpend').textContent = formatMoney(totalSpend);
  document.getElementById('sumRevenue').textContent = formatMoney(totalRevenue);
  const el = document.getElementById('netProfit');
  el.textContent = formatMoney(netProfit);
  el.classList.remove('positive', 'negative');
  if (netProfit > 0) el.classList.add('positive');
  else if (netProfit < 0) el.classList.add('negative');
  el.style.color = '';

  if (totalsMetaRow && totalsMetaText) {
    if (s && s.overridesActive && s.latestOverride) {
      const d = s.latestOverride.created_at ? new Date(s.latestOverride.created_at) : null;
      const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '';
      const r = s.latestOverride.reason || '';
      totalsMetaRow.style.display = '';
      totalsMetaText.textContent = `Edited totals permanently${when ? ` on ${when}` : ''}${r ? ` – ${r}` : ''}`;
    } else {
      totalsMetaRow.style.display = 'none';
      totalsMetaText.textContent = '';
    }
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function getInStockOptions() {
  const productsById = (state.products || []).reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {});

  const byKey = {};
  (state.inventory || []).forEach((inv) => {
    if (!inv || toNumber(inv.quantity) <= 0) return;
    const p = productsById[inv.product_id];
    if (!p) return;
    const spec = (p.specs || []).find((s) => s.id === inv.product_spec_id);
    if (!spec) return;
    const key = `${inv.product_id}|${inv.product_spec_id}`;
    if (!byKey[key]) {
      byKey[key] = {
        product_id: inv.product_id,
        product_spec_id: spec.id,
        labelBase: `${p.name} ${spec.spec}`,
        qty: 0,
      };
    }
    byKey[key].qty += toNumber(inv.quantity);
  });
  return Object.values(byKey).map((o) => ({
    product_id: o.product_id,
    product_spec_id: o.product_spec_id,
    label: `${o.labelBase} (${o.qty} in stock)`,
  }));
}

function openSaleModal() {
  const select = document.getElementById('saleItem');
  const opts = getInStockOptions();
  select.innerHTML = '<option value="">Select item</option>' + opts.map((o) => `<option value="${o.product_id}|${o.product_spec_id}">${escapeHtml(o.label)}</option>`).join('');
  document.getElementById('saleForm').reset();
  document.getElementById('saleId').value = '';
  document.getElementById('saleClient').value = '';
  const submitBtn = document.getElementById('saleSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Add sale';
  document.getElementById('saleModal').setAttribute('aria-hidden', 'false');
}

function openEditSaleModal(sale) {
  const select = document.getElementById('saleItem');
  const opts = getInStockOptions();
  select.innerHTML = '<option value="">Select item</option>' + opts.map((o) => `<option value="${o.product_id}|${o.product_spec_id}">${escapeHtml(o.label)}</option>`).join('');

  document.getElementById('saleForm').reset();
  document.getElementById('saleId').value = sale.id;
  document.getElementById('saleQty').value = sale.quantity_sold;
  document.getElementById('salePrice').value = sale.sell_price_per_sub;
  document.getElementById('saleClient').value = sale.client_name || '';

  const value = `${sale.product_id}|${sale.product_spec_id}`;
  document.getElementById('saleItem').value = value;

  const submitBtn = document.getElementById('saleSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Save changes';

  document.getElementById('saleModal').setAttribute('aria-hidden', 'false');
}

function closeSaleModal() {
  document.getElementById('saleModal').setAttribute('aria-hidden', 'true');
}

document.getElementById('addSale').addEventListener('click', openSaleModal);
document.getElementById('closeSaleModal').addEventListener('click', closeSaleModal);
document.getElementById('cancelSale').addEventListener('click', closeSaleModal);

document.getElementById('saleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = document.getElementById('saleItem').value;
  if (!val) return;
  const [product_id, product_spec_id] = val.split('|');
  const quantity_sold = parseInt(document.getElementById('saleQty').value, 10) || 0;
  const sell_price_per_sub = parseFloat(document.getElementById('salePrice').value) || 0;
  const client_name = document.getElementById('saleClient').value.trim() || null;
  const saleId = document.getElementById('saleId').value || null;
  try {
    if (saleId) {
      await api(`/sales/${saleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity_sold, sell_price_per_sub, client_name }),
      });
    } else {
      await api('/sales', {
        method: 'POST',
        body: JSON.stringify({ product_id, product_spec_id, quantity_sold, sell_price_per_sub, client_name }),
      });
    }
    closeSaleModal();
    await loadAll();
  } catch (err) {
    alert(err.message);
  }
});

function openProductsModal() {
  renderProductList();
  document.getElementById('productsModal').setAttribute('aria-hidden', 'false');
}

function closeProductsModal() {
  document.getElementById('productsModal').setAttribute('aria-hidden', 'true');
}

function renderProductList() {
  const ul = document.getElementById('productList');
  ul.innerHTML = state.products
    .map(
      (p) => `
    <li>
      <span class="name">${escapeHtml(p.name)}</span>
      <button type="button" class="btn btn-small edit-product" data-id="${p.id}">Edit</button>
      <button type="button" class="btn-delete delete-product" data-id="${p.id}" aria-label="Delete">×</button>
    </li>`
    )
    .join('');
  ul.querySelectorAll('.edit-product').forEach((b) => b.addEventListener('click', () => openProductForm(b.dataset.id)));
  ul.querySelectorAll('.delete-product').forEach((b) => b.addEventListener('click', () => deleteProduct(b.dataset.id)));
}

document.getElementById('seedData').addEventListener('click', async () => {
  if (!confirm('Load PDF product list? This only adds new products/specs.')) return;
  try {
    await api('/seed', { method: 'POST' });
    await loadAll();
    renderProductList();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('manageProducts').addEventListener('click', (e) => {
  e.preventDefault();
  openProductsModal();
});
document.getElementById('closeProductsModal').addEventListener('click', closeProductsModal);

function openProductForm(productId = null) {
  const isEdit = !!productId;
  document.getElementById('productFormTitle').textContent = isEdit ? 'Edit product' : 'Add product';
  document.getElementById('productId').value = productId || '';
  document.getElementById('productForm').reset();

  const container = document.getElementById('specsContainer');
  container.innerHTML = '';

  if (isEdit) {
    const product = state.products.find((p) => p.id === productId);
    if (product) {
      document.getElementById('productName').value = product.name;
      (product.specs || []).forEach((s) => addSpecRow(container, s));
    }
  } else {
    addSpecRow(container);
  }

  document.getElementById('productFormModal').setAttribute('aria-hidden', 'false');
}

function addSpecRow(container, spec = null) {
  const div = document.createElement('div');
  div.className = 'spec-row';
  div.innerHTML = `
    <input type="text" placeholder="Spec" value="${spec ? escapeHtml(spec.spec) : ''}" data-spec />
    <input type="number" placeholder="Price" step="0.01" value="${spec ? spec.price : ''}" data-price />
    <input type="text" placeholder="Cat.No" value="${spec ? escapeHtml(spec.cat_no || '') : ''}" data-catno />
    <button type="button" class="btn btn-small remove-spec">−</button>
  `;
  if (spec?.id) div.dataset.specId = spec.id;
  container.appendChild(div);
  div.querySelector('.remove-spec').addEventListener('click', () => div.remove());
}

document.getElementById('addSpecRow').addEventListener('click', () => addSpecRow(document.getElementById('specsContainer')));

function closeProductForm() {
  document.getElementById('productFormModal').setAttribute('aria-hidden', 'true');
}

document.getElementById('closeProductForm').addEventListener('click', closeProductForm);
document.getElementById('cancelProductForm').addEventListener('click', closeProductForm);

document.getElementById('addProduct').addEventListener('click', () => openProductForm());

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const productId = document.getElementById('productId').value;
  const name = document.getElementById('productName').value.trim();
  if (!name) return;

  const specRows = document.querySelectorAll('#specsContainer .spec-row');
  const specs = [];
  specRows.forEach((row) => {
    const spec = row.querySelector('[data-spec]').value.trim();
    const price = parseFloat(row.querySelector('[data-price]').value);
    if (!spec || isNaN(price)) return;
    specs.push({
      id: row.dataset.specId,
      spec,
      price,
      cat_no: row.querySelector('[data-catno]').value.trim() || null,
    });
  });
  if (specs.length === 0) {
    alert('Add at least one spec (spec + price).');
    return;
  }

  try {
    if (productId) {
      await api(`/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      const existing = (state.products.find((p) => p.id === productId)?.specs || []).map((s) => s.id);
      for (const s of specs) {
        if (s.id) {
          await api(`/specs/${s.id}`, { method: 'PATCH', body: JSON.stringify({ spec: s.spec, price: s.price, cat_no: s.cat_no }) });
        } else {
          await api(`/products/${productId}/specs`, { method: 'POST', body: JSON.stringify({ spec: s.spec, price: s.price, cat_no: s.cat_no }) });
        }
      }
      for (const id of existing) {
        if (!specs.some((s) => s.id === id)) await api(`/specs/${id}`, { method: 'DELETE' });
      }
    } else {
      const created = await api('/products', { method: 'POST', body: JSON.stringify({ name }) });
      for (const s of specs) {
        await api(`/products/${created.id}/specs`, { method: 'POST', body: JSON.stringify({ spec: s.spec, price: s.price, cat_no: s.cat_no }) });
      }
    }
    closeProductForm();
    await loadAll();
    if (!productId) closeProductsModal();
  } catch (err) {
    alert(err.message);
  }
});

async function deleteProduct(id) {
  if (!confirm('Delete this product? This will remove its specs and any inventory/sales.')) return;
  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    await loadAll();
    renderProductList();
  } catch (err) {
    alert(err.message);
  }
}

const salesClientFilterEl = document.getElementById('salesClientFilter');
if (salesClientFilterEl) {
  salesClientFilterEl.addEventListener('change', (e) => {
    state.salesClientFilter = e.target.value || '';
    renderSalesTable();
  });
}

// Total spend / revenue editing (permanent, with history in backend)
const editTotalSpendBtn = document.getElementById('editTotalSpend');
const totalSpendModal = document.getElementById('totalSpendModal');
const closeTotalSpendModalBtn = document.getElementById('closeTotalSpendModal');
const totalSpendCurrentText = document.getElementById('totalSpendCurrentText');
const totalSpendResultText = document.getElementById('totalSpendResultText');
const totalSpendDeltaInput = document.getElementById('totalSpendDelta');
const incrementTotalSpendBtn = document.getElementById('incrementTotalSpend');
const decrementTotalSpendBtn = document.getElementById('decrementTotalSpend');
const totalSpendReasonInput = document.getElementById('totalSpendReasonInput');
const saveTotalSpendBtn = document.getElementById('saveTotalSpend');
const cancelTotalSpendBtn = document.getElementById('cancelTotalSpend');

const editTotalRevenueBtn = document.getElementById('editTotalRevenue');
const totalRevenueModal = document.getElementById('totalRevenueModal');
const closeTotalRevenueModalBtn = document.getElementById('closeTotalRevenueModal');
const totalRevenueCurrentText = document.getElementById('totalRevenueCurrentText');
const totalRevenueResultText = document.getElementById('totalRevenueResultText');
const totalRevenueDeltaInput = document.getElementById('totalRevenueDelta');
const incrementTotalRevenueBtn = document.getElementById('incrementTotalRevenue');
const decrementTotalRevenueBtn = document.getElementById('decrementTotalRevenue');
const totalRevenueReasonInput = document.getElementById('totalRevenueReasonInput');
const saveTotalRevenueBtn = document.getElementById('saveTotalRevenue');
const cancelTotalRevenueBtn = document.getElementById('cancelTotalRevenue');

const totalsMetaRow = document.getElementById('totalsMetaRow');
const totalsMetaText = document.getElementById('totalsMetaText');
const viewOverrideHistoryBtn = document.getElementById('viewOverrideHistory');
const overridesHistoryModal = document.getElementById('overridesHistoryModal');
const closeOverridesHistoryBtn = document.getElementById('closeOverridesHistory');
const overridesHistoryBody = document.getElementById('overridesHistoryBody');

let pendingManualTotalSpend = null;
let pendingManualTotalRevenue = null;

if (
  editTotalSpendBtn &&
  totalSpendModal &&
  totalSpendCurrentText &&
  totalSpendResultText &&
  totalSpendReasonInput &&
  saveTotalSpendBtn &&
  cancelTotalSpendBtn &&
  totalSpendDeltaInput &&
  incrementTotalSpendBtn &&
  decrementTotalSpendBtn
) {
  function getCurrentTotalSpendBase() {
    const s = state.summary || {};
    if (s.totalSpend != null && s.totalSpend !== undefined) return Number(s.totalSpend);
    if (s.computedTotalSpend != null && s.computedTotalSpend !== undefined) return Number(s.computedTotalSpend);
    return 0;
  }

  function applyTotalSpendDelta(sign) {
    if (!totalSpendDeltaInput) return;
    const base = getCurrentTotalSpendBase();

    const deltaRaw = totalSpendDeltaInput.value.trim();
    if (!deltaRaw) {
      alert('Enter an adjustment amount.');
      return;
    }
    const delta = parseFloat(deltaRaw);
    if (Number.isNaN(delta)) {
      alert('Enter a valid adjustment amount.');
      return;
    }

    const next = base + sign * delta;
    if (!Number.isFinite(next)) {
      alert('Resulting total is invalid.');
      return;
    }

    pendingManualTotalSpend = next;
    if (totalSpendResultText) {
      totalSpendResultText.textContent = formatMoney(next);
    }
  }

  function openTotalSpendModal() {
    const base = getCurrentTotalSpendBase();
    pendingManualTotalSpend = null;
    totalSpendCurrentText.textContent = formatMoney(base);
    if (totalSpendResultText) {
      totalSpendResultText.textContent = formatMoney(base);
    }
    totalSpendReasonInput.value = '';
    if (totalSpendDeltaInput) {
      totalSpendDeltaInput.value = '';
    }
    totalSpendModal.setAttribute('aria-hidden', 'false');
  }

  function closeTotalSpendModal() {
    pendingManualTotalSpend = null;
    totalSpendModal.setAttribute('aria-hidden', 'true');
  }

  editTotalSpendBtn.addEventListener('click', openTotalSpendModal);
  cancelTotalSpendBtn.addEventListener('click', closeTotalSpendModal);
  if (closeTotalSpendModalBtn) {
    closeTotalSpendModalBtn.addEventListener('click', closeTotalSpendModal);
  }

  incrementTotalSpendBtn.addEventListener('click', () => applyTotalSpendDelta(1));
  decrementTotalSpendBtn.addEventListener('click', () => applyTotalSpendDelta(-1));

  saveTotalSpendBtn.addEventListener('click', async () => {
    const reason = totalSpendReasonInput.value.trim();
    let v = pendingManualTotalSpend;

    if (v == null) {
      const base = getCurrentTotalSpendBase();
      const deltaRaw = totalSpendDeltaInput ? totalSpendDeltaInput.value.trim() : '';
      if (!deltaRaw) {
        alert('Enter an adjustment amount before saving.');
        return;
      }
      const delta = parseFloat(deltaRaw);
      if (Number.isNaN(delta)) {
        alert('Enter a valid adjustment amount.');
        return;
      }
      v = base + delta;
    }

    if (!Number.isFinite(v)) {
      alert('Resulting total is invalid.');
      return;
    }

    const payload = {
      manual_total_spend: v,
      reason: reason || undefined,
    };
    try {
      await api('/summary/override-totals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      pendingManualTotalSpend = null;
      if (totalSpendDeltaInput) totalSpendDeltaInput.value = '';
      closeTotalSpendModal();
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  });
}

if (
  editTotalRevenueBtn &&
  totalRevenueModal &&
  totalRevenueCurrentText &&
  totalRevenueResultText &&
  totalRevenueDeltaInput &&
  incrementTotalRevenueBtn &&
  decrementTotalRevenueBtn &&
  totalRevenueReasonInput &&
  saveTotalRevenueBtn &&
  cancelTotalRevenueBtn
) {
  function getCurrentTotalRevenueBase() {
    const s = state.summary || {};
    if (s.totalRevenue != null && s.totalRevenue !== undefined) return Number(s.totalRevenue);
    if (s.computedTotalRevenue != null && s.computedTotalRevenue !== undefined) return Number(s.computedTotalRevenue);
    return 0;
  }

  function applyTotalRevenueDelta(sign) {
    if (!totalRevenueDeltaInput) return;
    const base = getCurrentTotalRevenueBase();

    const deltaRaw = totalRevenueDeltaInput.value.trim();
    if (!deltaRaw) {
      alert('Enter an adjustment amount.');
      return;
    }
    const delta = parseFloat(deltaRaw);
    if (Number.isNaN(delta)) {
      alert('Enter a valid adjustment amount.');
      return;
    }

    const next = base + sign * delta;
    if (!Number.isFinite(next)) {
      alert('Resulting total is invalid.');
      return;
    }

    pendingManualTotalRevenue = next;
    if (totalRevenueResultText) {
      totalRevenueResultText.textContent = formatMoney(next);
    }
  }

  function openTotalRevenueModal() {
    const base = getCurrentTotalRevenueBase();
    pendingManualTotalRevenue = null;
    totalRevenueCurrentText.textContent = formatMoney(base);
    if (totalRevenueResultText) {
      totalRevenueResultText.textContent = formatMoney(base);
    }
    totalRevenueReasonInput.value = '';
    if (totalRevenueDeltaInput) {
      totalRevenueDeltaInput.value = '';
    }
    totalRevenueModal.setAttribute('aria-hidden', 'false');
  }

  function closeTotalRevenueModal() {
    pendingManualTotalRevenue = null;
    totalRevenueModal.setAttribute('aria-hidden', 'true');
  }

  editTotalRevenueBtn.addEventListener('click', openTotalRevenueModal);
  cancelTotalRevenueBtn.addEventListener('click', closeTotalRevenueModal);
  if (closeTotalRevenueModalBtn) {
    closeTotalRevenueModalBtn.addEventListener('click', closeTotalRevenueModal);
  }

  incrementTotalRevenueBtn.addEventListener('click', () => applyTotalRevenueDelta(1));
  decrementTotalRevenueBtn.addEventListener('click', () => applyTotalRevenueDelta(-1));

  saveTotalRevenueBtn.addEventListener('click', async () => {
    const reason = totalRevenueReasonInput.value.trim();
    let v = pendingManualTotalRevenue;

    if (v == null) {
      const base = getCurrentTotalRevenueBase();
      const deltaRaw = totalRevenueDeltaInput ? totalRevenueDeltaInput.value.trim() : '';
      if (!deltaRaw) {
        alert('Enter an adjustment amount before saving.');
        return;
      }
      const delta = parseFloat(deltaRaw);
      if (Number.isNaN(delta)) {
        alert('Enter a valid adjustment amount.');
        return;
      }
      v = base + delta;
    }

    if (!Number.isFinite(v)) {
      alert('Resulting total is invalid.');
      return;
    }

    const payload = {
      manual_total_revenue: v,
      reason: reason || undefined,
    };
    try {
      await api('/summary/override-totals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      pendingManualTotalRevenue = null;
      if (totalRevenueDeltaInput) totalRevenueDeltaInput.value = '';
      closeTotalRevenueModal();
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  });
}

async function openOverridesHistory() {
  if (!overridesHistoryModal || !overridesHistoryBody) return;
  try {
    const history = (await api('/summary/overrides')) || [];
    overridesHistoryBody.innerHTML =
      history
        .map((h) => {
          const d = h.created_at ? new Date(h.created_at) : null;
          const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '';
          const spend =
            h.manual_total_spend != null && h.manual_total_spend !== undefined
              ? formatMoney(h.manual_total_spend)
              : '—';
          const revenue =
            h.manual_total_revenue != null && h.manual_total_revenue !== undefined
              ? formatMoney(h.manual_total_revenue)
              : '—';
          const reason = h.reason || '';
          return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td class="num">${spend}</td>
          <td class="num">${revenue}</td>
          <td>${escapeHtml(reason)}</td>
        </tr>`;
        })
        .join('') || '<tr><td colspan="4">No manual edits yet.</td></tr>';
    overridesHistoryModal.setAttribute('aria-hidden', 'false');
  } catch (err) {
    alert(err.message);
  }
}

function closeOverridesHistory() {
  if (!overridesHistoryModal) return;
  overridesHistoryModal.setAttribute('aria-hidden', 'true');
}

if (viewOverrideHistoryBtn && overridesHistoryModal && closeOverridesHistoryBtn && overridesHistoryBody) {
  viewOverrideHistoryBtn.addEventListener('click', openOverridesHistory);
  closeOverridesHistoryBtn.addEventListener('click', closeOverridesHistory);
}

loadAll();
