/**
 * Dummy frontend – mock data only, no backend. Open dummy.html in a browser to preview the UI.
 */

const uid = () => crypto.randomUUID?.() ?? 'id-' + Math.random().toString(36).slice(2);

const mockProducts = [
  { id: uid(), name: 'Semaglutide', specs: [{ id: uid(), spec: '5mg', price: 37, cat_no: 'SM5' }, { id: uid(), spec: '10mg', price: 48, cat_no: 'SM10' }, { id: uid(), spec: '15mg', price: 62, cat_no: 'SM15' }] },
  { id: uid(), name: 'Retatrutide', specs: [{ id: uid(), spec: '10mg', price: 95, cat_no: 'RT10' }, { id: uid(), spec: '20mg', price: 150, cat_no: 'RT20' }] },
  { id: uid(), name: 'BPC157', specs: [{ id: uid(), spec: '5mg', price: 45, cat_no: 'BC5' }, { id: uid(), spec: '10mg', price: 64, cat_no: 'BC10' }] },
];

let state = {
  products: [...mockProducts],
  inventory: [],
  sales: [],
};

function initDummyState() {
  const [p1, p2, p3] = state.products;
  state.inventory = [
    { id: uid(), product_id: p1.id, product_spec_id: p1.specs[1].id, quantity: 2 },
    { id: uid(), product_id: p2.id, product_spec_id: p2.specs[0].id, quantity: 1 },
    { id: uid(), product_id: p3.id, product_spec_id: p3.specs[1].id, quantity: 3 },
  ];
  state.sales = [
    { id: uid(), product_id: p1.id, product_spec_id: p1.specs[1].id, product_name: 'Semaglutide', spec: '10mg', quantity_sold: 5, sell_price_per_sub: 100, revenue: 500 },
    { id: uid(), product_id: p2.id, product_spec_id: p2.specs[0].id, product_name: 'Retatrutide', spec: '10mg', quantity_sold: 3, sell_price_per_sub: 120, revenue: 360 },
  ];
}

function getSummary() {
  let totalSpend = 0;
  const invByProduct = {};
  state.inventory.forEach((i) => { invByProduct[i.product_id] = i; });
  state.products.forEach((p) => {
    const inv = invByProduct[p.id];
    const spec = (p.specs || []).find((s) => s.id === inv?.product_spec_id) || p.specs?.[0];
    if (spec) totalSpend += Number(spec.price) * (inv?.quantity ?? 0);
  });
  let totalRevenue = 0;
  state.sales.forEach((s) => { totalRevenue += Number(s.revenue) || 0; });
  return { totalSpend, totalRevenue, netProfit: totalRevenue - totalSpend };
}

function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function getInventoryByProduct() {
  const by = {};
  state.inventory.forEach((i) => { by[i.product_id] = i; });
  return by;
}

function render() {
  renderSpendTable();
  renderSalesTable();
  renderSummary();
}

function renderSpendTable() {
  const tbody = document.getElementById('spendBody');
  const rows = state.inventory.filter((i) => (i.quantity || 0) > 0);
  let totalSpend = 0;
  const list = rows.map((r) => {
    const product = state.products.find((p) => p.id === r.product_id);
    const spec = (product?.specs || []).find((s) => s.id === r.product_spec_id);
    const price = spec ? Number(spec.price) : 0;
    const qty = r.quantity || 0;
    totalSpend += price * qty;
    return { ...r, product_name: product?.name, spec: spec?.spec, cat_no: spec?.cat_no, price };
  });

  tbody.innerHTML = list
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.cat_no || '-')}</td>
      <td>${escapeHtml(r.product_name || '')}</td>
      <td>${escapeHtml(r.spec || '')}</td>
      <td class="num">${formatMoney(r.price)}</td>
      <td class="num">${r.quantity}</td>
      <td class="num">${formatMoney(r.price * (r.quantity || 0))}</td>
      <td><button type="button" class="btn btn-small btn-delete" data-product-id="${r.product_id}" data-spec-id="${r.product_spec_id}">Delete</button></td>
    </tr>`
    )
    .join('');

  document.getElementById('totalSpend').textContent = formatMoney(totalSpend);

  tbody.querySelectorAll('button[data-product-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inv = state.inventory.find((i) => i.product_id === btn.dataset.productId && i.product_spec_id === btn.dataset.specId);
      if (inv) inv.quantity = 0;
      render();
    });
  });
}

function openPurchaseModal() {
  const productSelect = document.getElementById('purchaseProduct');
  productSelect.innerHTML = '<option value="">Select product</option>' + state.products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  document.getElementById('purchaseSpec').innerHTML = '<option value="">Select spec</option>';
  document.getElementById('purchaseForm').reset();
  document.getElementById('purchaseModal').setAttribute('aria-hidden', 'false');
}

function updatePurchaseSpecDropdown() {
  const productId = document.getElementById('purchaseProduct').value;
  const specSelect = document.getElementById('purchaseSpec');
  specSelect.innerHTML = '<option value="">Select spec</option>';
  if (!productId) return;
  const product = state.products.find((p) => p.id === productId);
  if (product && product.specs) product.specs.forEach((s) => specSelect.appendChild(new Option(`${s.spec} — ${formatMoney(s.price)}`, s.id)));
}

function closePurchaseModal() {
  document.getElementById('purchaseModal').setAttribute('aria-hidden', 'true');
}

document.getElementById('addPurchase').addEventListener('click', openPurchaseModal);
document.getElementById('closePurchaseModal').addEventListener('click', closePurchaseModal);
document.getElementById('cancelPurchase').addEventListener('click', closePurchaseModal);
document.getElementById('purchaseProduct').addEventListener('change', updatePurchaseSpecDropdown);

document.getElementById('purchaseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const product_id = document.getElementById('purchaseProduct').value;
  const product_spec_id = document.getElementById('purchaseSpec').value;
  const addQty = Math.max(0, parseInt(document.getElementById('purchaseQty').value, 10) || 0);
  if (!product_id || !product_spec_id) return;
  let inv = state.inventory.find((i) => i.product_id === product_id);
  if (inv && inv.product_spec_id === product_spec_id) inv.quantity = (inv.quantity || 0) + addQty;
  else if (inv) {
    inv.product_spec_id = product_spec_id;
    inv.quantity = addQty;
  } else {
    state.inventory.push({ id: uid(), product_id, product_spec_id, quantity: addQty });
  }
  closePurchaseModal();
  render();
});

function renderSalesTable() {
  const tbody = document.getElementById('salesBody');
  let totalRevenue = 0;
  state.sales.forEach((s) => { totalRevenue += Number(s.revenue) || 0; });
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
    btn.addEventListener('click', () => {
      state.sales = state.sales.filter((s) => s.id !== btn.dataset.saleId);
      render();
    });
  });
}

function renderSummary() {
  const s = getSummary();
  document.getElementById('sumSpend').textContent = formatMoney(s.totalSpend);
  document.getElementById('sumRevenue').textContent = formatMoney(s.totalRevenue);
  const el = document.getElementById('netProfit');
  el.textContent = formatMoney(s.netProfit);
  el.classList.remove('positive', 'negative');
  if (s.netProfit > 0) el.classList.add('positive');
  else if (s.netProfit < 0) el.classList.add('negative');
  el.style.color = '';
}

function getInStockOptions() {
  const invByProduct = getInventoryByProduct();
  const options = [];
  state.products.forEach((p) => {
    const inv = invByProduct[p.id];
    if (!inv || (inv.quantity || 0) <= 0) return;
    const spec = (p.specs || []).find((s) => s.id === inv.product_spec_id);
    if (!spec) return;
    options.push({ product_id: p.id, product_spec_id: spec.id, label: `${p.name} ${spec.spec}` });
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

document.getElementById('saleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('saleItem').value;
  if (!val) return;
  const [product_id, product_spec_id] = val.split('|');
  const product = state.products.find((p) => p.id === product_id);
  const spec = product?.specs?.find((s) => s.id === product_spec_id);
  const quantity_sold = parseInt(document.getElementById('saleQty').value, 10) || 0;
  const sell_price_per_sub = parseFloat(document.getElementById('salePrice').value) || 0;
  const revenue = quantity_sold * sell_price_per_sub;
  state.sales.push({
    id: uid(),
    product_id,
    product_spec_id,
    product_name: product?.name,
    spec: spec?.spec,
    quantity_sold,
    sell_price_per_sub,
    revenue,
  });
  closeSaleModal();
  render();
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
  } else addSpecRow(container);
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

document.getElementById('productForm').addEventListener('submit', (e) => {
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
  if (productId) {
    const product = state.products.find((p) => p.id === productId);
    if (product) {
      product.name = name;
      const existingIds = (product.specs || []).map((s) => s.id);
      product.specs = specs.map((s) => {
        const existing = (product.specs || []).find((sp) => sp.id === s.id);
        return existing ? { ...existing, spec: s.spec, price: s.price, cat_no: s.cat_no } : { id: uid(), spec: s.spec, price: s.price, cat_no: s.cat_no };
      });
    }
  } else {
    state.products.push({
      id: uid(),
      name,
      specs: specs.map((s) => ({ id: uid(), spec: s.spec, price: s.price, cat_no: s.cat_no })),
    });
  }
  closeProductForm();
  render();
  if (!productId) closeProductsModal();
});

function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  state.products = state.products.filter((p) => p.id !== id);
  state.inventory = state.inventory.filter((i) => i.product_id !== id);
  state.sales = state.sales.filter((s) => s.product_id !== id);
  render();
  renderProductList();
}

initDummyState();
render();
