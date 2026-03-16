import { Router } from 'express';
import { supabase } from '../db.js';

export const summaryRouter = Router();

// GET /summary – totalSpend, totalRevenue, netProfit (with optional manual overrides)
summaryRouter.get('/', async (req, res) => {
  try {
    const { data: inv } = await supabase.from('inventory').select(`
      quantity,
      product_specs ( price )
    `);
    let computedTotalSpend = 0;
    for (const row of inv || []) {
      const price = row.product_specs?.price ? Number(row.product_specs.price) : 0;
      computedTotalSpend += price * (row.quantity || 0);
    }

    const { data: salesRows } = await supabase.from('sales').select('revenue');
    let computedTotalRevenue = 0;
    for (const row of salesRows || []) {
      computedTotalRevenue += Number(row.revenue) || 0;
    }

    const computedNetProfit = computedTotalRevenue - computedTotalSpend;

    // Look for latest manual total overrides
    const { data: overrides, error: overrideError } = await supabase
      .from('summary_overrides')
      .select('manual_total_spend, manual_total_revenue, reason, effective_from, created_at')
      .order('effective_from', { ascending: false })
      .limit(1);
    if (overrideError) throw overrideError;

    const latest = overrides && overrides.length > 0 ? overrides[0] : null;
    const totalSpend = latest && latest.manual_total_spend != null ? Number(latest.manual_total_spend) : computedTotalSpend;
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
    const payload = { reason: reason || null };
    if (manual_total_spend != null && manual_total_spend !== '') {
      const v = Number(manual_total_spend);
      if (!Number.isFinite(v)) return res.status(400).json({ error: 'manual_total_spend must be a number' });
      payload.manual_total_spend = v;
    }
    if (manual_total_revenue != null && manual_total_revenue !== '') {
      const v = Number(manual_total_revenue);
      if (!Number.isFinite(v)) return res.status(400).json({ error: 'manual_total_revenue must be a number' });
      payload.manual_total_revenue = v;
    }
    const { data, error } = await supabase
      .from('summary_overrides')
      .insert(payload)
      .select('id, manual_total_spend, manual_total_revenue, reason, effective_from, created_at')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary/overrides – list manual total overrides (most recent first)
summaryRouter.get('/overrides', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('summary_overrides')
      .select('id, manual_total_spend, manual_total_revenue, reason, effective_from, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
