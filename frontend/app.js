// API base URL: set in build or use same origin when served with API
const API = window.API_BASE_URL || '';

async function api(path, options = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

let state = {
  products: [],
  inventory: [],
  sales: [],
  summary: { totalSpend: 0, totalRevenue: 0, netProfit: 0 },
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
    state.summary = summary || { totalSpend: 0, totalRevenue: 0, netProfit: 0 };
    render();
  } catch (e) {
    console.error(e);
    document.getElementById('spendBody').innerHTML = `<tr><td colspan="6" class="error">Failed to load: ${e.message}</td></tr>`;
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
  const invByProduct = getInventoryByProduct();
  const tbody = document.getElementById('spendBody');
  let totalSpend = 0;

  const rows = state.products.map((product) => {
    const inv = invByProduct[product.id];
    const specId = inv?.product_spec_id;
    const specs = product.specs || [];
    const selectedSpec = specs.find((s) => s.id === specId) || specs[0];
    const price = selectedSpec ? Number(selectedSpec.price) : 0;
    const qty = inv?.quantity ?? 0;
    const total = price * qty;
    totalSpend += total;
    return {
      product,
      selectedSpec,
      specs,
      price,
      qty,
      total,
    };
  });

  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr data-product-id="${r.product.id}">
      <td>${r.selectedSpec?.cat_no ?? '-'}</td>
      <td>${escapeHtml(r.product.name)}</td>
      <td>
        <select data-product-id="${r.product.id}" class="spec-select" data-spec-id>
          ${r.specs.map((s) => `<option value="${s.id}" ${s.id === r.selectedSpec?.id ? 'selected' : ''}>${escapeHtml(s.spec)}</option>`).join('')}
        </select>
      </td>
      <td class="num">${formatMoney(r.price)}</td>
      <td><input type="number" min="0" value="${r.qty}" data-product-id="${r.product.id}" class="qty-input" /></td>
      <td class="num">${formatMoney(r.total)}</td>
    </tr>`
    )
    .join('');

  document.getElementById('totalSpend').textContent = formatMoney(totalSpend);

  tbody.querySelectorAll('.spec-select').forEach((sel) => {
    sel.addEventListener('change', () => onSpendSpecChange(sel.dataset.productId, sel.value));
  });
  tbody.querySelectorAll('.qty-input').forEach((inp) => {
    inp.addEventListener('change', () => onSpendQtyChange(inp.dataset.productId, inp.value));
  });
}

async function onSpendSpecChange(productId, productSpecId) {
  const product = state.products.find((p) => p.id === productId);
  const spec = product?.specs?.find((s) => s.id === productSpecId);
  if (!spec) return;
  const inv = state.inventory.find((i) => i.product_id === productId);
  const qty = inv?.quantity ?? 0;
  try {
    await api('/inventory', {
      method: 'PUT',
      body: JSON.stringify({ product_id: productId, product_spec_id: productSpecId, quantity: qty }),
    });
    await loadAll();
  } catch (e) {
    console.error(e);
  }
}

async function onSpendQtyChange(productId, value) {
  const qty = Math.max(0, parseInt(value, 10) || 0);
  const inv = state.inventory.find((i) => i.product_id === productId);
  const product = state.products.find((p) => p.id === productId);
  const specId = inv?.product_spec_id || product?.specs?.[0]?.id;
  if (!specId) return;
  try {
    await api('/inventory', {
      method: 'PUT',
      body: JSON.stringify({ product_id: productId, product_spec_id: specId, quantity: qty }),
    });
    await loadAll();
  } catch (e) {
    console.error(e);
  }
}

function renderSalesTable() {
  const tbody = document.getElementById('salesBody');
  let totalRevenue = 0;
  state.sales.forEach((s) => {
    totalRevenue += Number(s.revenue) || 0;
  });
  tbody.innerHTML = state.sales
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.product_name || '')} ${escapeHtml(s.spec || '')}</td>
      <td class="num">${s.quantity_sold}</td>
      <td class="num">${formatMoney(s.sell_price_per_sub)}</td>
      <td class="num">${formatMoney(s.revenue)}</td>
      <td><button type="button" class="btn btn-small btn-delete" data-sale-id="${s.id}">Delete</button></td>
    </tr>`
    )
    .join('');
  document.getElementById('totalRevenue').textContent = formatMoney(totalRevenue);
  tbody.querySelectorAll('[data-sale-id]').forEach((btn) => {
    btn.addEventListener('click', () => deleteSale(btn.dataset.saleId));
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
  el.textContent = formatMoney(s.netProfit);
  el.style.color = s.netProfit >= 0 ? 'var(--accent)' : 'var(--danger)';
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
  try {
    await api('/sales', {
      method: 'POST',
      body: JSON.stringify({ product_id, product_spec_id, quantity_sold, sell_price_per_sub }),
    });
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

loadAll();
