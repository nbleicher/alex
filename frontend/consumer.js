const API = window.API_BASE_URL || '';

const state = {
  products: [],
  cart: [],
};

const CART_ICON = `
  <svg class="cart-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="cart-basket" d="M8 8h11l-1.4 6.1c-.16.7-.78 1.2-1.5 1.2H10.2c-.72 0-1.34-.5-1.5-1.2L7.2 6.4H4.6a1 1 0 1 1 0-2H8a1 1 0 0 1 .98.8L9.4 7h9.9a1 1 0 0 1 .98 1.23l-.04.17Z"></path>
    <path class="cart-handle" d="M9.2 6h9.1a1 1 0 0 1 0 2H9.8"></path>
    <circle class="cart-wheel wheel-left" cx="11" cy="18.5" r="1.8"></circle>
    <circle class="cart-wheel wheel-right" cx="16.8" cy="18.5" r="1.8"></circle>
    <circle class="cart-wheel-core" cx="11" cy="18.5" r="0.7"></circle>
    <circle class="cart-wheel-core" cx="16.8" cy="18.5" r="0.7"></circle>
  </svg>
`;

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw data || { error: 'Request failed' };
  return data;
}

function openModal(id) {
  document.getElementById(id).setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  document.getElementById(id).setAttribute('aria-hidden', 'true');
}

function escapeHtml(v) {
  const el = document.createElement('div');
  el.textContent = v == null ? '' : String(v);
  return el.innerHTML;
}

function addToCart(product, spec) {
  const key = `${product.id}|${spec.id}`;
  const existing = state.cart.find((i) => i.key === key);
  if (existing) existing.quantity += 1;
  else {
    state.cart.push({
      key,
      product_id: product.id,
      product_spec_id: spec.id,
      label: `${product.name} ${spec.spec}`,
      quantity: 1,
    });
  }
  renderCart();
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  const cards = [];
  for (const product of state.products) {
    for (const spec of product.specs || []) {
      cards.push(`
        <article class="product-card">
          <img class="product-image" src="${escapeHtml(spec.image_url || product.image_url || '')}" alt="${escapeHtml(product.name)}" />
          <div class="product-meta">
            <span>${escapeHtml(product.name)} ${escapeHtml(spec.spec)}</span>
            <button
              data-add="${product.id}|${spec.id}"
              aria-label="Add ${escapeHtml(product.name)} ${escapeHtml(spec.spec)} to cart"
              title="Add to cart"
            >${CART_ICON}</button>
          </div>
        </article>
      `);
    }
  }
  grid.innerHTML = cards.join('');
  grid.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [pid, sid] = btn.dataset.add.split('|');
      const product = state.products.find((p) => p.id === pid);
      const spec = product?.specs?.find((s) => s.id === sid);
      if (product && spec) addToCart(product, spec);
    });
  });
}

function renderCart() {
  document.getElementById('cartCount').textContent = String(
    state.cart.reduce((sum, i) => sum + i.quantity, 0),
  );
  const wrap = document.getElementById('cartItems');
  if (state.cart.length === 0) {
    wrap.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    return;
  }
  wrap.innerHTML = state.cart
    .map(
      (item) => `
      <div class="cart-row">
        <span class="cart-item-label">${escapeHtml(item.label)}</span>
        <input class="cart-qty-input" type="number" min="1" value="${item.quantity}" data-qty="${item.key}" />
        <button class="cart-remove-btn" data-remove="${item.key}">Remove</button>
      </div>
    `,
    )
    .join('');

  wrap.querySelectorAll('[data-qty]').forEach((input) => {
    input.addEventListener('change', () => {
      const row = state.cart.find((i) => i.key === input.dataset.qty);
      if (!row) return;
      row.quantity = Math.max(1, parseInt(input.value, 10) || 1);
      renderCart();
    });
  });
  wrap.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.cart = state.cart.filter((i) => i.key !== btn.dataset.remove);
      renderCart();
    });
  });
}

async function loadProducts() {
  state.products = (await api('/products/public')) || [];
  renderProducts();
}

async function submitCheckout(e) {
  e.preventDefault();
  const errorEl = document.getElementById('checkoutError');
  errorEl.textContent = '';
  try {
    const payload = {
      first_name: document.getElementById('firstName').value.trim(),
      last_name: document.getElementById('lastName').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      referral: document.getElementById('referral').value.trim() || null,
      items: state.cart.map((i) => ({
        product_spec_id: i.product_spec_id,
        quantity: i.quantity,
      })),
    };
    const order = await api('/orders', { method: 'POST', body: JSON.stringify(payload) });
    state.cart = [];
    renderCart();
    closeModal('checkoutModal');
    closeModal('cartModal');
    document.getElementById('confirmationText').textContent =
      `Order #${order.order_number}. Savage Peptides will be reaching out shortly to complete your order`;
    openModal('confirmationModal');
    document.getElementById('checkoutForm').reset();
  } catch (err) {
    const shortages = err?.shortages || [];
    if (shortages.length > 0) {
      errorEl.textContent = shortages.map((s) => s.message).join('\n');
      return;
    }
    errorEl.textContent = err?.error || 'Checkout failed';
  }
}

function showAdminLogin() {
  document.getElementById('adminLoginModal').setAttribute('aria-hidden', 'false');
}

function hideAdminLogin() {
  document.getElementById('adminLoginModal').setAttribute('aria-hidden', 'true');
}

async function checkAdminAuth() {
  try {
    const me = await api('/admin-auth/me');
    return !!me?.authenticated;
  } catch (_) {
    return false;
  }
}

document.getElementById('openAdmin').addEventListener('click', async () => {
  const isAuthed = await checkAdminAuth();
  if (isAuthed) {
    window.location.href = '/admin/';
    return;
  }
  showAdminLogin();
});
document.getElementById('openCart').addEventListener('click', () => openModal('cartModal'));
document.getElementById('closeCart').addEventListener('click', () => closeModal('cartModal'));
document.getElementById('checkoutBtn').addEventListener('click', () => {
  if (state.cart.length === 0) return;
  openModal('checkoutModal');
});
document.getElementById('closeCheckout').addEventListener('click', () => closeModal('checkoutModal'));
document.getElementById('checkoutForm').addEventListener('submit', submitCheckout);
document.getElementById('closeConfirmation').addEventListener('click', () =>
  closeModal('confirmationModal'),
);
document.getElementById('closeAdminLogin').addEventListener('click', hideAdminLogin);
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loginError = document.getElementById('adminLoginError');
  loginError.textContent = '';
  try {
    await api('/admin-auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('adminUsername').value.trim(),
        password: document.getElementById('adminPassword').value,
      }),
    });
    hideAdminLogin();
    window.location.href = '/admin/';
  } catch (err) {
    loginError.textContent = err?.error || 'Login failed';
  }
});

loadProducts().catch((err) => {
  document.getElementById('productGrid').innerHTML = `<p class="error">${escapeHtml(err?.error || err.message || 'Failed to load products')}</p>`;
});

