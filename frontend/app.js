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
  summary: { totalSpend: 0, totalRevenue: 0, netProfit: 0, computedNetProfit: 0, netProfitOverridden: false, lastOverride: null },
  salesClientFilter: '',
  isEditingNetProfit: false,
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
    state.summary = summary || { totalSpend: 0, totalRevenue: 0, netProfit: 0, computedNetProfit: 0 };
    render();
  } catch (e) {
    console.error(e);
    document.getElementById('spendBody').innerHTML = `<tr><td colspan="7" class="error">Failed to load: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function render() {
  renderSpendTable();
  renderSalesTable();
  renderSummary();
}

function getInventoryByProduct() {
  const by = {};
  for (const row of state.inventory) {
    by[row.product_id] = row;
  }
  return by;
}

function renderSpendTable() {
  const tbody = document.getElementById('spendBody');
  const items = (state.inventory || []).filter((i) => (i.quantity || 0) > 0);

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

  let totalSpend = 0;
  orderKeys.forEach((key) => {
    groups[key].forEach((r) => {
      totalSpend += (Number(r.price) || 0) * (r.quantity || 0);
    });
  });

  tbody.innerHTML = orderKeys
    .map((dateKey, idx) => {
      const orderId = `order-${idx}`;
      const rows = groups[dateKey];
      const orderTotal = rows.reduce(
        (sum, r) => sum + (Number(r.price) || 0) * (r.quantity || 0),
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

      const detailsRows = rows
        .map(
          (r) => `
              <tr>
                <td>${escapeHtml(r.cat_no || '-')}</td>
                <td>${escapeHtml(r.product_name || '')}</td>
                <td>${escapeHtml(r.spec || '')}</td>
                <td class="num">${formatMoney(r.price)}</td>
                <td class="num">${r.quantity}</td>
                <td class="num">${formatMoney((Number(r.price) || 0) * (r.quantity || 0))}</td>
                <td>
                  <button type="button" class="btn btn-small btn-delete"
                    data-product-id="${r.product_id}"
                    data-spec-id="${r.product_spec_id}">
                    Delete
                  </button>
                </td>
              </tr>`,
        )
        .join('');

      return `
        <tr class="order-row" data-order-id="${orderId}">
          <td>
            <button type="button" class="btn btn-small toggle-order" data-order-id="${orderId}">▼</button>
            ${escapeHtml(orderLabel)}
          </td>
          <td>${escapeHtml(summaryText)}</td>
          <td class="num">${formatMoney(orderTotal)}</td>
          <td></td>
        </tr>
        <tr class="order-details" data-order-id="${orderId}" style="display:none;">
          <td colspan="4">
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
  tbody.querySelectorAll('button[data-product-id]').forEach((btn) => {
    btn.addEventListener('click', () => deletePurchase(btn.dataset.productId, btn.dataset.specId));
  });
}

async function deletePurchase(productId, productSpecId) {
  try {
    await api('/inventory', {
      method: 'PUT',
      body: JSON.stringify({ product_id: productId, product_spec_id: productSpecId, quantity: 0 }),
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
}

function closePurchaseModal() {
  document.getElementById('purchaseModal').setAttribute('aria-hidden', 'true');
}

document.getElementById('addPurchase').addEventListener('click', openPurchaseModal);
document.getElementById('closePurchaseModal').addEventListener('click', closePurchaseModal);
document.getElementById('cancelPurchase').addEventListener('click', closePurchaseModal);
document.getElementById('purchaseProduct').addEventListener('change', updatePurchaseSpecDropdown);

document.getElementById('purchaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const product_id = document.getElementById('purchaseProduct').value;
  const product_spec_id = document.getElementById('purchaseSpec').value;
  const addQty = Math.max(0, parseInt(document.getElementById('purchaseQty').value, 10) || 0);
  const purchase_date = document.getElementById('purchaseDate').value || null;
  if (!product_id || !product_spec_id) return;
  const existing = state.inventory.find((i) => i.product_id === product_id);
  const quantity = existing && existing.product_spec_id === product_spec_id ? (existing.quantity || 0) + addQty : addQty;
  try {
    await api('/inventory', {
      method: 'PUT',
      body: JSON.stringify({ product_id, product_spec_id, quantity, purchase_date }),
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

  // Filter and sort: cluster by client then sale date
  const filtered = allSales
    .filter((s) => {
      if (!state.salesClientFilter) return true;
      const key = (s.client_name || '(none)').trim() || '(none)';
      return key === state.salesClientFilter;
    })
    .slice()
    .sort((a, b) => {
      const ca = (a.client_name || '').toLowerCase();
      const cb = (b.client_name || '').toLowerCase();
      if (ca < cb) return -1;
      if (ca > cb) return 1;
      const da = new Date(a.created_at || 0).getTime();
      const db = new Date(b.created_at || 0).getTime();
      return db - da; // newest first within client
    });

  let totalRevenue = 0;
  filtered.forEach((s) => {
    totalRevenue += Number(s.revenue) || 0;
  });

  tbody.innerHTML = filtered
    .map((s) => {
      let dateLabel = '';
      if (s.created_at) {
        const d = new Date(s.created_at);
        if (!Number.isNaN(d.getTime())) {
          dateLabel = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
      }
      const clientLabel = (s.client_name || '').trim() || '—';
      return `
    <tr>
      <td>${escapeHtml(dateLabel || '-')}</td>
      <td>${escapeHtml(clientLabel)}</td>
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
  document.getElementById('totalRevenue').textContent = formatMoney(totalRevenue);
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
  document.getElementById('sumSpend').textContent = formatMoney(s.totalSpend);
  document.getElementById('sumRevenue').textContent = formatMoney(s.totalRevenue);
  const el = document.getElementById('netProfit');
  const metaRow = document.getElementById('netProfitMetaRow');
  const metaText = document.getElementById('netProfitMetaText');

  const netProfit = s.netProfit;
  el.textContent = formatMoney(netProfit);
  el.classList.remove('positive', 'negative');
  if (netProfit > 0) el.classList.add('positive');
  else if (netProfit < 0) el.classList.add('negative');
  el.style.color = '';

  if (s.netProfitOverridden && s.lastOverride) {
    if (metaRow && metaText) {
      const d = s.lastOverride.created_at ? new Date(s.lastOverride.created_at) : null;
      const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '';
      const reason = s.lastOverride.reason || '';
      metaRow.style.display = '';
      metaText.textContent = `Edited permanently${when ? ` on ${when}` : ''}${reason ? ` – ${reason}` : ''}`;
    }
  } else if (metaRow && metaText) {
    metaRow.style.display = 'none';
    metaText.textContent = '';
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function getInStockOptions() {
  const invByProduct = getInventoryByProduct();
  const options = [];
  state.products.forEach((p) => {
    const inv = invByProduct[p.id];
    if (!inv || (inv.quantity || 0) <= 0) return;
    const spec = (p.specs || []).find((s) => s.id === inv.product_spec_id);
    if (!spec) return;
    options.push({
      product_id: p.id,
      product_spec_id: spec.id,
      label: `${p.name} ${spec.spec}`,
    });
  });
  return options;
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

// Net profit editing (permanent, with history in backend)
const editNetProfitBtn = document.getElementById('editNetProfit');
const netProfitEditRow = document.getElementById('netProfitEditRow');
const netProfitInput = document.getElementById('netProfitInput');
const netProfitReason = document.getElementById('netProfitReason');
const saveNetProfitBtn = document.getElementById('saveNetProfit');
const cancelNetProfitBtn = document.getElementById('cancelNetProfit');

if (editNetProfitBtn && netProfitEditRow && netProfitInput && netProfitReason && saveNetProfitBtn && cancelNetProfitBtn) {
  editNetProfitBtn.addEventListener('click', () => {
    state.isEditingNetProfit = true;
    const s = state.summary || {};
    const current = s.netProfit != null ? Number(s.netProfit) : 0;
    netProfitInput.value = current;
    netProfitReason.value = '';
    netProfitEditRow.style.display = '';
  });

  cancelNetProfitBtn.addEventListener('click', () => {
    state.isEditingNetProfit = false;
    netProfitEditRow.style.display = 'none';
  });

  saveNetProfitBtn.addEventListener('click', async () => {
    const value = parseFloat(netProfitInput.value);
    if (Number.isNaN(value)) {
      alert('Enter a valid number for net profit.');
      return;
    }
    const reason = netProfitReason.value.trim();
    try {
      await api('/summary/net-profit-override', {
        method: 'POST',
        body: JSON.stringify({ manual_net_profit: value, reason }),
      });
      state.isEditingNetProfit = false;
      netProfitEditRow.style.display = 'none';
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  });
}

loadAll();
