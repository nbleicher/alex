import { Router } from 'express';
import { query, queryOne } from '../db.js';

export const summaryRouter = Router();

const OVERRIDE_COLUMNS =
  'id, manual_total_spend, manual_total_revenue, spend_adjustment, reason, effective_from, created_at';

async function getComputedTotals() {
  const inv = await query(`
    select i.quantity, i.unit_cost, ps.price as catalog_price
    from inventory i
    left join product_specs ps on ps.id = i.product_spec_id`);
  let computedTotalSpend = 0;
  for (const row of inv) {
    const catalog = row.catalog_price != null ? Number(row.catalog_price) : 0;
    const unit = row.unit_cost != null && row.unit_cost !== '' ? Number(row.unit_cost) : catalog;
    const price = Number.isFinite(unit) ? unit : 0;
    computedTotalSpend += price * (row.quantity || 0);
  }

  const salesRows = await query('select revenue from sales');
  let computedTotalRevenue = 0;
  for (const row of salesRows) {
    computedTotalRevenue += Number(row.revenue) || 0;
  }

  return {
    computedTotalSpend,
    computedTotalRevenue,
    computedNetProfit: computedTotalRevenue - computedTotalSpend,
  };
}

function getLatestOverride() {
  return queryOne(`select ${OVERRIDE_COLUMNS} from summary_overrides order by effective_from desc limit 1`);
}

// GET /summary – totalSpend, totalRevenue, netProfit (with optional manual overrides)
summaryRouter.get('/', async (req, res) => {
  try {
    const { computedTotalSpend, computedTotalRevenue, computedNetProfit } = await getComputedTotals();
    const latest = await getLatestOverride();

    let spendAdjustment = 0;
    if (latest) {
      if (latest.spend_adjustment != null) {
        const v = Number(latest.spend_adjustment);
        spendAdjustment = Number.isFinite(v) ? v : 0;
      } else if (latest.manual_total_spend != null) {
        // Legacy rows had absolute manual totals, which froze spend.
        // Ignore them here so new purchases continue to change spend.
        spendAdjustment = 0;
      }
    }

    const totalSpend = computedTotalSpend + spendAdjustment;
    const totalRevenue =
      latest && latest.manual_total_revenue != null ? Number(latest.manual_total_revenue) : computedTotalRevenue;
    const netProfit = totalRevenue - totalSpend;

    res.json({
      totalSpend,
      totalRevenue,
      netProfit,
      computedTotalSpend,
      computedTotalRevenue,
      computedNetProfit,
      overridesActive: !!latest,
      latestOverride: latest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /summary/override-totals – create a new manual override for totals (history is append-only)
summaryRouter.post('/override-totals', async (req, res) => {
  try {
    const { manual_total_spend, manual_total_revenue, reason } = req.body || {};
    if (
      (manual_total_spend == null || manual_total_spend === '') &&
      (manual_total_revenue == null || manual_total_revenue === '')
    ) {
      return res.status(400).json({ error: 'At least one of manual_total_spend or manual_total_revenue is required' });
    }
    let manualSpend = null;
    let spendAdjustment = null;
    let manualRevenue = null;
    if (manual_total_spend != null && manual_total_spend !== '') {
      const v = Number(manual_total_spend);
      if (!Number.isFinite(v)) return res.status(400).json({ error: 'manual_total_spend must be a number' });
      const { computedTotalSpend } = await getComputedTotals();
      spendAdjustment = v - computedTotalSpend;
      manualSpend = v;
    }
    if (manual_total_revenue != null && manual_total_revenue !== '') {
      const v = Number(manual_total_revenue);
      if (!Number.isFinite(v)) return res.status(400).json({ error: 'manual_total_revenue must be a number' });
      manualRevenue = v;
    }
    const data = await queryOne(
      `insert into summary_overrides (manual_total_spend, manual_total_revenue, spend_adjustment, reason)
       values ($1, $2, $3, $4) returning ${OVERRIDE_COLUMNS}`,
      [manualSpend, manualRevenue, spendAdjustment, reason || null],
    );
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary/overrides – list manual total overrides (most recent first)
summaryRouter.get('/overrides', async (_req, res) => {
  try {
    res.json(await query(`select ${OVERRIDE_COLUMNS} from summary_overrides order by created_at desc`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /summary/overrides/:id – remove a manual override entry
summaryRouter.delete('/overrides/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Override id is required' });
    await query('delete from summary_overrides where id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
