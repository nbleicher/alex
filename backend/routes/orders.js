import { Router } from 'express';
import { query, queryOne } from '../db.js';

export const ordersRouter = Router();

const OPEN_STATUSES = ['processing', 'payment_received'];
const NEXT_STATUS = {
  processing: 'payment_received',
  payment_received: 'fulfilled',
};
const PREV_STATUS = {
  payment_received: 'processing',
  fulfilled: 'payment_received',
};

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

async function getOrderItemsAndReservations(orderId) {
  const itemRows = await query('select id, ordered_quantity from order_items where order_id = $1', [orderId]);
  if (itemRows.length === 0) return { itemRows: [], reservations: [] };
  const reservations = await query(
    'select id, order_item_id, inventory_id, quantity from order_item_reservations where order_item_id = any($1::uuid[])',
    [itemRows.map((i) => i.id)],
  );
  return { itemRows, reservations };
}

async function adjustInventoryFromReservations(reservations, mode = 'deduct') {
  const byInventory = {};
  for (const r of reservations || []) {
    byInventory[r.inventory_id] = (byInventory[r.inventory_id] || 0) + toInt(r.quantity);
  }
  const inventoryIds = Object.keys(byInventory);
  if (inventoryIds.length === 0) return;

  const inventoryRows = await query('select id, quantity from inventory where id = any($1::uuid[])', [inventoryIds]);
  for (const row of inventoryRows) {
    const delta = byInventory[row.id] || 0;
    const nextQty =
      mode === 'add' ? Math.max(0, toInt(row.quantity) + delta) : Math.max(0, toInt(row.quantity) - delta);
    await query('update inventory set quantity = $2, updated_at = now() where id = $1', [row.id, nextQty]);
  }
}

async function buildShortagesForRequest(items) {
  const specIds = [...new Set(items.map((it) => it.product_spec_id))];
  if (specIds.length === 0) return [];

  const specs = await query(
    `select ps.id, ps.product_id, ps.spec, p.name as product_name
     from product_specs ps
     left join products p on p.id = ps.product_id
     where ps.id = any($1::uuid[])`,
    [specIds],
  );

  const inventoryRows = await query(
    `select product_spec_id, quantity from inventory
     where product_spec_id = any($1::uuid[]) and status = 'Delivered' and quantity > 0`,
    [specIds],
  );

  const openOrderItems = await query(
    `select oi.product_spec_id, oi.ordered_quantity
     from order_items oi
     join orders o on o.id = oi.order_id
     where oi.product_spec_id = any($1::uuid[]) and o.status = any($2::text[])`,
    [specIds, OPEN_STATUSES],
  );

  const inventoryBySpec = {};
  for (const row of inventoryRows) {
    const key = row.product_spec_id;
    inventoryBySpec[key] = (inventoryBySpec[key] || 0) + Math.max(0, toInt(row.quantity));
  }

  const existingDemandBySpec = {};
  for (const row of openOrderItems) {
    const key = row.product_spec_id;
    existingDemandBySpec[key] = (existingDemandBySpec[key] || 0) + Math.max(0, toInt(row.ordered_quantity));
  }

  const requestedBySpec = {};
  for (const row of items) {
    requestedBySpec[row.product_spec_id] = (requestedBySpec[row.product_spec_id] || 0) + row.quantity;
  }

  const specById = specs.reduce((acc, s) => {
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
      const productName = spec?.product_name || 'Unknown';
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
  const inventoryRows = await query(`
    select id, product_spec_id, quantity
    from inventory
    where status = 'Delivered' and quantity > 0
    order by purchase_date asc nulls last, created_at asc`);

  // open items, oldest order first, then oldest item
  const eligibleItems = await query(
    `select oi.id, oi.product_spec_id, oi.ordered_quantity
     from order_items oi
     join orders o on o.id = oi.order_id
     where o.status = any($1::text[])
     order by o.created_at asc, oi.created_at asc`,
    [OPEN_STATUSES],
  );

  const openItemIds = eligibleItems.map((it) => it.id);
  if (openItemIds.length > 0) {
    await query('delete from order_item_reservations where order_item_id = any($1::uuid[])', [openItemIds]);
  }

  const inventoryBySpec = {};
  for (const row of inventoryRows) {
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
    await query(
      `insert into order_item_reservations (order_item_id, inventory_id, quantity)
       select * from unnest($1::uuid[], $2::uuid[], $3::int[])`,
      [
        reservations.map((r) => r.order_item_id),
        reservations.map((r) => r.inventory_id),
        reservations.map((r) => r.quantity),
      ],
    );
  }

  if (eligibleItems.length > 0) {
    await query(
      `update order_items oi set reserved_quantity = v.reserved
       from unnest($1::uuid[], $2::int[]) as v(id, reserved)
       where oi.id = v.id`,
      [openItemIds, openItemIds.map((itemId) => reservedByItem[itemId] || 0)],
    );
  }
}

async function serializeOrderById(orderId) {
  const order = await queryOne('select * from orders where id = $1', [orderId]);
  if (!order) return null;

  const items = await query(
    `select id, order_id, product_id, product_spec_id, product_name_snapshot, spec_snapshot,
            ordered_quantity, reserved_quantity, unit_price
     from order_items where order_id = $1 order by created_at asc`,
    [orderId],
  );

  return {
    ...order,
    items: items.map((it) => ({
      ...it,
      missing_quantity: Math.max(0, toInt(it.ordered_quantity) - toInt(it.reserved_quantity)),
    })),
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

const SPEC_WITH_NAME = `
  select ps.id, ps.product_id, ps.spec, ps.price, p.name as product_name
  from product_specs ps
  left join products p on p.id = ps.product_id`;

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

    const order = await queryOne(
      `insert into orders (order_number, first_name, last_name, phone, referral, status)
       values ($1, $2, $3, $4, $5, 'processing') returning *`,
      [
        newOrderNumber(),
        String(first_name).trim(),
        String(last_name).trim(),
        String(phone).trim(),
        referral ? String(referral).trim() : null,
      ],
    );

    const specIds = [...new Set(normalizedItems.map((it) => it.product_spec_id))];
    const specs = await query(`${SPEC_WITH_NAME} where ps.id = any($1::uuid[])`, [specIds]);
    const specById = specs.reduce((acc, s) => {
      acc[s.id] = s;
      return acc;
    }, {});

    const insertItems = normalizedItems.map((it) => {
      const spec = specById[it.product_spec_id];
      if (!spec) {
        throw new Error(`Spec ${it.product_spec_id} not found`);
      }
      return {
        product_id: spec.product_id,
        product_spec_id: spec.id,
        product_name_snapshot: spec.product_name || 'Unknown',
        spec_snapshot: spec.spec || 'Unknown',
        ordered_quantity: it.quantity,
        unit_price: Number(spec.price) || 0,
      };
    });

    await query(
      `insert into order_items
         (order_id, product_id, product_spec_id, product_name_snapshot, spec_snapshot, ordered_quantity, unit_price)
       select $1::uuid, * from unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::int[], $7::numeric[])`,
      [
        order.id,
        insertItems.map((it) => it.product_id),
        insertItems.map((it) => it.product_spec_id),
        insertItems.map((it) => it.product_name_snapshot),
        insertItems.map((it) => it.spec_snapshot),
        insertItems.map((it) => it.ordered_quantity),
        insertItems.map((it) => it.unit_price),
      ],
    );

    await recomputeOpenOrderReservations();
    return res.status(201).json(await serializeOrderById(order.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.get('/', async (_req, res) => {
  try {
    const orders = await query('select * from orders order by created_at asc');
    if (orders.length === 0) return res.json([]);

    const items = await query(
      `select id, order_id, product_name_snapshot, spec_snapshot, ordered_quantity, reserved_quantity, unit_price
       from order_items where order_id = any($1::uuid[]) order by created_at asc`,
      [orders.map((o) => o.id)],
    );

    const itemsByOrder = {};
    for (const item of items) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        ...item,
        missing_quantity: Math.max(0, toInt(item.ordered_quantity) - toInt(item.reserved_quantity)),
      });
    }

    res.json(
      orders.map((o) => ({
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

    const order = await queryOne('select * from orders where id = $1', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const expectedNext = NEXT_STATUS[order.status];
    const expectedPrev = PREV_STATUS[order.status];
    const isAllowed = nextStatus === expectedNext || nextStatus === expectedPrev;
    if (!isAllowed) {
      return res.status(400).json({
        error:
          `Invalid status transition. Allowed: ${order.status} -> ${expectedNext || '(none)'}` +
          `${expectedPrev ? ` or ${expectedPrev}` : ''}`,
      });
    }

    if (nextStatus === 'fulfilled') {
      const { itemRows, reservations } = await getOrderItemsAndReservations(id);

      const reservedByItem = {};
      for (const r of reservations) {
        reservedByItem[r.order_item_id] = (reservedByItem[r.order_item_id] || 0) + toInt(r.quantity);
      }
      for (const it of itemRows) {
        if ((reservedByItem[it.id] || 0) < toInt(it.ordered_quantity)) {
          return res.status(409).json({
            error: 'Order cannot be fulfilled because inventory is not fully reserved',
          });
        }
      }
      await adjustInventoryFromReservations(reservations, 'deduct');
    }

    if (order.status === 'fulfilled' && nextStatus === 'payment_received') {
      const { reservations } = await getOrderItemsAndReservations(id);
      await adjustInventoryFromReservations(reservations, 'add');
    }

    await query('update orders set status = $2, updated_at = now() where id = $1', [id, nextStatus]);

    await recomputeOpenOrderReservations();
    res.json(await serializeOrderById(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const order = await queryOne('select id, status from orders where id = $1', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status === 'fulfilled') {
      const { reservations } = await getOrderItemsAndReservations(id);
      await adjustInventoryFromReservations(reservations, 'add');
    }

    await query('delete from orders where id = $1', [id]);

    await recomputeOpenOrderReservations();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ordersRouter.patch('/:id/items', async (req, res) => {
  try {
    const orderId = req.params.id;
    const productSpecId = String(req.body?.product_spec_id || '').trim();
    const quantity = Math.max(0, toInt(req.body?.quantity));
    if (!productSpecId || quantity <= 0) {
      return res.status(400).json({ error: 'product_spec_id and quantity (>0) are required' });
    }

    const order = await queryOne('select id, status from orders where id = $1', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!OPEN_STATUSES.includes(order.status)) {
      return res.status(409).json({
        error: 'Items can only be added to orders in processing or payment_received',
      });
    }

    // Always verify against delivered inventory before adding new order demand.
    const shortages = await buildShortagesForRequest([{ product_spec_id: productSpecId, quantity }]);
    if (shortages.length > 0) {
      return res.status(409).json({
        error: 'Inventory is not sufficient for one or more items',
        shortages,
      });
    }

    const spec = await queryOne(`${SPEC_WITH_NAME} where ps.id = $1`, [productSpecId]);
    if (!spec) return res.status(404).json({ error: 'Product spec not found' });

    const existingItem = await queryOne(
      'select id, ordered_quantity from order_items where order_id = $1 and product_spec_id = $2',
      [orderId, productSpecId],
    );

    if (existingItem) {
      const nextQty = Math.max(0, toInt(existingItem.ordered_quantity) + quantity);
      await query('update order_items set ordered_quantity = $2 where id = $1', [existingItem.id, nextQty]);
    } else {
      await query(
        `insert into order_items
           (order_id, product_id, product_spec_id, product_name_snapshot, spec_snapshot, ordered_quantity, unit_price)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          spec.product_id,
          spec.id,
          spec.product_name || 'Unknown',
          spec.spec || 'Unknown',
          quantity,
          Number(spec.price) || 0,
        ],
      );
    }

    await recomputeOpenOrderReservations();
    res.json(await serializeOrderById(orderId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
