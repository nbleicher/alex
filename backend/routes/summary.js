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

    const netProfit = totalRevenue - totalSpend;
    res.json({ totalSpend, totalRevenue, netProfit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
