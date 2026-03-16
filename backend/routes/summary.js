import { Router } from 'express';
import { supabase } from '../db.js';

export const summaryRouter = Router();

// GET /summary – totalSpend, totalRevenue, netProfit
summaryRouter.get('/', async (req, res) => {
  try {
    const { data: inv } = await supabase.from('inventory').select(`
      quantity,
      product_specs ( price )
    `);
    let totalSpend = 0;
    for (const row of inv || []) {
      const price = row.product_specs?.price ? Number(row.product_specs.price) : 0;
      totalSpend += price * (row.quantity || 0);
    }

    const { data: salesRows } = await supabase.from('sales').select('revenue');
    let totalRevenue = 0;
    for (const row of salesRows || []) {
      totalRevenue += Number(row.revenue) || 0;
    }

    const computedNetProfit = totalRevenue - totalSpend;

    // Look for latest manual override
    const { data: overrides, error: overrideError } = await supabase
      .from('net_profit_overrides')
      .select('manual_net_profit, reason, effective_from, created_at')
      .order('effective_from', { ascending: false })
      .limit(1);
    if (overrideError) throw overrideError;

    const latest = overrides && overrides.length > 0 ? overrides[0] : null;
    const netProfit = latest ? Number(latest.manual_net_profit) : computedNetProfit;

    res.json({
      totalSpend,
      totalRevenue,
      netProfit,
      computedNetProfit,
      netProfitOverridden: !!latest,
      lastOverride: latest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /summary/net-profit-override – create a new manual override (history is append-only)
summaryRouter.post('/net-profit-override', async (req, res) => {
  try {
    const { manual_net_profit, reason } = req.body || {};
    if (manual_net_profit == null || manual_net_profit === '') {
      return res.status(400).json({ error: 'manual_net_profit is required' });
    }
    const value = Number(manual_net_profit);
    if (!Number.isFinite(value)) {
      return res.status(400).json({ error: 'manual_net_profit must be a number' });
    }
    const { data, error } = await supabase
      .from('net_profit_overrides')
      .insert({
        manual_net_profit: value,
        reason: reason || null,
      })
      .select('id, manual_net_profit, reason, effective_from, created_at')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary/net-profit-history – list manual overrides (most recent first)
summaryRouter.get('/net-profit-history', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('net_profit_overrides')
      .select('id, manual_net_profit, reason, effective_from, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
