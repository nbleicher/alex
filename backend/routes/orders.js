import { Router } from 'express';
import { supabase } from '../db.js';

export const ordersRouter = Router();

const OPEN_STATUSES = ['processing', 'payment_received'];
const NEXT_STATUS = {
  processing: 'payment_received',
  payment_received: 'fulfilled',
};

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

async function buildShortagesForRequest(items) {
  const specIds = [...new Set(items.map((it) => it.product_spec_id))];
  if (specIds.length === 0) return [];

  const { data: specs, error: specsError } = await supabase
    .from('product_specs')
    .select('id, product_id, spec, products(name)')
    .in('id', specIds);
  if (specsError) throw specsError;

  const { data: inventoryRows, error: invError } = await supabase
    .from('inventory')
    .select('product_spec_id, quantity')
    .in('product_spec_id', specIds);
  if (invError) throw invError;

  const { data: openOrderItems, error: openItemsError } = await supabase
    .from('order_items')
    .select('product_spec_id, ordered_quantity, orders(status)')
    .in('product_spec_id', specIds);
  if (openItemsError) throw openItemsError;

  const inventoryBySpec = {};
  for (const row of inventoryRows || []) {
    const key = row.product_spec_id;
    inventoryBySpec[key] = (inventoryBySpec[key] || 0) + Math.max(0, toInt(row.quantity));
  }

  const existingDemandBySpec = {};
  for (const row of openOrderItems || []) {
    const status = row.orders?.status;
    if (!OPEN_STATUSES.includes(status)) continue;
    const key = row.product_spec_id;
    existingDemandBySpec[key] = (existingDemandBySpec[key] || 0) + Math.max(0, toInt(row.ordered_quantity));
  }

  const requestedBySpec = {};
  for (const row of items) {
    requestedBySpec[row.product_spec_id] = (requestedBySpec[row.product_spec_id] || 0) + row.quantity;
  }

  const specById = (specs || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {});

  const shortages = [];
  for (const specId of Object.keys(requestedBySpec)) {
    const requested = requestedBySpec[specId];
    const inventoryTotal = inventoryBySpec[specId] || 0;
    const existingDemand = existingDemandBySpec[specId] || 0;
    const remainingForNewOrder = Math.max(0, inventoryTotal - existingDemand);
    const missing = Math.max(0, requested - remainingForNewOrder);
    if (missing > 0) {
      const spec = specById[specId];
      const productName = spec?.products?.name || 'Unknown';
      const specName = spec?.spec || 'Unknown';
      shortages.push({
        product_spec_id: specId,
        product_label: `${productName} ${specName}`,
        inventory: remainingForNewOrder,
        missing,
        message: `${productName} ${specName} | inventory: ${remainingForNewOrder} | missing: ${missing}`,
      });
    }
  }
  return shortages;
}

export async function recomputeOpenOrderReservations() {
  const { data: inventoryRows, error: invError } = await supabase
    .from('inventory')
    .select('id, product_spec_id, quantity, purchase_date, created_at')
    .gt('quantity', 0)
    .order('purchase_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (invError) throw invError;

  const { data: openItems, error: openItemsError } = await supabase
    .from('order_items')
    .select('id, order_id, product_spec_id, ordered_quantity, orders(status, created_at)')
    .order('created_at', { ascending: true });
  if (openItemsError) throw openItemsError;

  const eligibleItems = (openItems || [])
    .filter((it) => OPEN_STATUSES.includes(it.orders?.status))
    .sort((a, b) => {
      const aCreated = new Date(a.orders?.created_at || 0).getTime();
      const bCreated = new Date(b.orders?.created_at || 0).getTime();
      if (aCreated !== bCreated) return aCreated - bCreated;
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });

  const openItemIds = eligibleItems.map((it) => it.id);
  if (openItemIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('order_item_reservations')
      .delete()
      .in('order_item_id', openItemIds);
    if (deleteError) throw deleteError;
  }

  const inventoryBySpec = {};
  for (const row of inventoryRows || []) {
    const specId = row.product_spec_id;
    if (!inventoryBySpec[specId]) inventoryBySpec[specId] = [];
    inventoryBySpec[specId].push({
      inventory_id: row.id,
      remaining: Math.max(0, toInt(row.quantity)),
    });
  }

  const reservations = [];
  const reservedByItem = {};
  for (const item of eligibleItems) {
    let qtyNeeded = Math.max(0, toInt(item.ordered_quantity));
    const buckets = inventoryBySpec[item.product_spec_id] || [];
    for (const bucket of buckets) {
      if (qtyNeeded <= 0) break;
      if (bucket.remaining <= 0) continue;
      const alloc = Math.min(qtyNeeded, bucket.remaining);
      bucket.remaining -= alloc;
      qtyNeeded -= alloc;
      reservations.push({
        order_item_id: item.id,
        inventory_id: bucket.inventory_id,
        quantity: alloc,
      });
      reservedByItem[item.id] = (reservedByItem[item.id] || 0) + alloc;
    }
    if (!reservedByItem[item.id]) reservedByItem[item.id] = 0;
  }

  if (reservations.length > 0) {
    const { error: insertError } = await supabase
      .from('order_item_reservations')
      .insert(reservations);
    if (insertError) throw insertError;
  }

  for (const item of eligibleItems) {
    const { error: updateError } = await supabase
      .from('order_items')
      .update({ reserved_quantity: reservedByItem[item.id] || 0 })
      .eq('id', item.id);
    if (updateError) throw updateError;
  }
}

async function serializeOrderById(orderId) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) return null;

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('id, order_id, product_id, product_spec_id, product_name_snapshot, spec_snapshot, ordered_quantity, reserved_quantity, unit_price')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (itemsError) throw itemsError;

  const normalizedItems = (items || []).map((it) => ({
    ...it,
    missing_quantity: Math.max(0, toInt(it.ordered_quantity) - toInt(it.reserved_quantity)),
  }));

  return {
    ...order,
    items: normalizedItems,
  };
}

function newOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SP-${y}${m}${d}-${suffix}`;
}

ordersRouter.post('/', async (req, res) => {
  try {
    const { first_name, last_name, phone, referral, items } = req.body || {};
    if (!first_name || !last_name || !phone || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'first_name, last_name, phone, and at least one item are required',
      });
    }

    const normalizedItems = [];
    for (const item of items) {
      const qty = toInt(item.quantity);
      if (!item.product_spec_id || qty <= 0) continue;
      normalizedItems.push({
        product_spec_id: item.product_spec_id,
        quantity: qty,
      });
    }
    if (normalizedItems.length === 0) {
      return res.status(400).json({ error: 'No valid items in cart' });
    }

    const shortages = await buildShortagesForRequest(normalizedItems);
    if (shortages.length > 0) {
      return res.status(409).json({
        error: 'Inventory is not sufficient for one or more items',
        shortages,
      });
    }

    const orderNumber = newOrderNumber();
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        phone: String(phone).trim(),
        referral: referral ? String(referral).trim() : null,
        status: 'processing',
      })
      .select('*')
      .single();
    if (orderError) throw orderError;

    const specIds = [...new Set(normalizedItems.map((it) => it.product_spec_id))];
    const { data: specs, error: specsError } = await supabase
      .from('product_specs')
      .select('id, product_id, spec, price, products(name)')
      .in('id', specIds);
    if (specsError) throw specsError;
    const specById = (specs || []).reduce((acc, s) => {
      acc[s.id] = s;
      return acc;
    }, {});

    const insertItems = normalizedItems.map((it) => {
      const spec = specById[it.product_spec_id];
      if (!spec) {
        throw new Error(`Spec ${it.product_spec_id} not found`);
      }
      return {
        order_id: order.id,
        product_id: spec.product_id,
        product_spec_id: spec.id,
        product_name_snapshot: spec.products?.name || 'Unknown',
        spec_snapshot: spec.spec || 'Unknown',
        ordered_quantity: it.quantity,
        unit_price: Number(spec.price) || 0,
      };
    });

    const { error: insertItemsError } = await supabase.from('order_items').insert(insertItems);
    if (insertItemsError) throw insertItemsError;

    await recomputeOpenOrderReservations();
    const withItems = await serializeOrderById(order.id);
    return res.status(201).json(withItems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.get('/', async (_req, res) => {
  try {
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: true });
    if (orderError) throw orderError;

    const orderIds = (orders || []).map((o) => o.id);
    if (orderIds.length === 0) return res.json([]);

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('id, order_id, product_name_snapshot, spec_snapshot, ordered_quantity, reserved_quantity, unit_price')
      .in('order_id', orderIds)
      .order('created_at', { ascending: true });
    if (itemsError) throw itemsError;

    const itemsByOrder = {};
    for (const item of items || []) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        ...item,
        missing_quantity: Math.max(0, toInt(item.ordered_quantity) - toInt(item.reserved_quantity)),
      });
    }

    res.json(
      (orders || []).map((o) => ({
        ...o,
        items: itemsByOrder[o.id] || [],
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.patch('/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const nextStatus = String(req.body?.status || '').trim();
    if (!nextStatus) return res.status(400).json({ error: 'status is required' });

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const expected = NEXT_STATUS[order.status];
    if (expected !== nextStatus) {
      return res.status(400).json({
        error: `Invalid status transition. Allowed: ${order.status} -> ${expected || '(none)'}`,
      });
    }

    if (nextStatus === 'fulfilled') {
      const { data: itemRows, error: itemError } = await supabase
        .from('order_items')
        .select('id, ordered_quantity')
        .eq('order_id', id);
      if (itemError) throw itemError;

      const itemIds = (itemRows || []).map((i) => i.id);
      const { data: reservations, error: reservationError } = await supabase
        .from('order_item_reservations')
        .select('id, order_item_id, inventory_id, quantity')
        .in('order_item_id', itemIds);
      if (reservationError) throw reservationError;

      const reservedByItem = {};
      for (const r of reservations || []) {
        reservedByItem[r.order_item_id] = (reservedByItem[r.order_item_id] || 0) + toInt(r.quantity);
      }
      for (const it of itemRows || []) {
        if ((reservedByItem[it.id] || 0) < toInt(it.ordered_quantity)) {
          return res.status(409).json({
            error: 'Order cannot be fulfilled because inventory is not fully reserved',
          });
        }
      }

      const byInventory = {};
      for (const r of reservations || []) {
        byInventory[r.inventory_id] = (byInventory[r.inventory_id] || 0) + toInt(r.quantity);
      }

      const inventoryIds = Object.keys(byInventory);
      if (inventoryIds.length > 0) {
        const { data: inventoryRows, error: invError } = await supabase
          .from('inventory')
          .select('id, quantity')
          .in('id', inventoryIds);
        if (invError) throw invError;

        for (const row of inventoryRows || []) {
          const deduct = byInventory[row.id] || 0;
          const nextQty = Math.max(0, toInt(row.quantity) - deduct);
          const { error: updateInvError } = await supabase
            .from('inventory')
            .update({ quantity: nextQty, updated_at: new Date().toISOString() })
            .eq('id', row.id);
          if (updateInvError) throw updateInvError;
        }
      }

      if ((reservations || []).length > 0) {
        const reservationIds = reservations.map((r) => r.id);
        const { error: deleteReservationError } = await supabase
          .from('order_item_reservations')
          .delete()
          .in('id', reservationIds);
        if (deleteReservationError) throw deleteReservationError;
      }
    }

    const { error: updateOrderError } = await supabase
      .from('orders')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateOrderError) throw updateOrderError;

    await recomputeOpenOrderReservations();
    const serialized = await serializeOrderById(id);
    res.json(serialized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

