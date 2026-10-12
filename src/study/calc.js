import { inr } from './data.js';
/* Small calculators. run(values, studyData) returns rows of [label, value]. Money is shown in INR with lakh/crore grouping.
   Rates (GST, TDS, tax slabs) come from editable tables in the Study Hub: verify them against the current law. */
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const pct = (x) => (Number.isFinite(x) ? r2(x) + '%' : '-');
const num = (x) => (Number.isFinite(x) ? r2(x).toLocaleString('en-IN') : '-');
export const parseRates = (t) => String(t).split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
export function slabTax(income, tt) {
  let tax = 0, prev = 0;
  for (const [upto, rate] of tt.slabs) { if (income > prev) tax += ((Math.min(income, upto) - prev) * rate) / 100; prev = upto; if (income <= upto) break; }
  const rebate = income <= tt.rebateLimit ? Math.min(tax, tt.rebateMax) : 0;
  const after = tax - rebate, cess = (after * tt.cess) / 100;
  return { tax, rebate, cess, total: after + cess };
}
export const CALCS = [
  { id: 'gst', title: 'GST', note: 'Rates come from the editable GST rate list below.', fields: [['amt', 'Amount (INR)', 10000], ['rate', 'GST rate %', 18], ['incl', 'Amount includes GST? (1 = yes, 0 = no)', 0], ['inter', 'Inter-state supply? (1 = IGST, 0 = CGST+SGST)', 0]],
    run: (v) => { const base = v.incl ? v.amt / (1 + v.rate / 100) : v.amt; const g = (base * v.rate) / 100; return [['Taxable value', inr(base)], ...(v.inter ? [['IGST', inr(g)]] : [['CGST', inr(g / 2)], ['SGST/UTGST', inr(g / 2)]]), ['Invoice total', inr(base + g)]]; } },
  { id: 'tds', title: 'TDS', note: 'Pick the rate from the editable TDS table below. Thresholds are not applied here.', fields: [['amt', 'Payment (INR)', 50000], ['rate', 'TDS rate %', 10]],
    run: (v) => { const t = (v.amt * v.rate) / 100; return [['TDS to deduct', inr(t)], ['Net payable', inr(v.amt - t)]]; } },
  { id: 'itax', title: 'Income-tax on total income (basic)', note: 'Uses the editable slab table. No marginal relief, surcharge or special rates.', fields: [['inc', 'Total income (INR)', 1000000]],
    run: (v, D) => { const r = slabTax(v.inc, D.taxTable); return [[`Tax (FY ${D.taxTable.fy})`, inr(r.tax)], ['Rebate u/s 87A', inr(r.rebate)], [`Cess ${D.taxTable.cess}%`, inr(r.cess)], ['Total tax', inr(r.total)], ['Average rate', pct((r.total / (v.inc || 1)) * 100)]]; } },
  { id: 'dep', title: 'Depreciation (Companies Act style)', note: 'Residual value is usually at most 5% of cost. Useful life as per Schedule II or your estimate.', fields: [['cost', 'Cost (INR)', 500000], ['res', 'Residual value (INR)', 25000], ['life', 'Useful life (years)', 8], ['years', 'Years to show (WDV)', 3]],
    run: (v) => { const slm = (v.cost - v.res) / v.life; const rate = 1 - (v.res / v.cost) ** (1 / v.life); let b = v.cost; const rows = [['SLM per year', inr(slm)], ['WDV rate p.a.', pct(rate * 100)]]; for (let y = 1; y <= v.years; y++) { const d = b * rate; b -= d; rows.push([`WDV year ${y}: depreciation / closing`, `${inr(d)} / ${inr(b)}`]); } return rows; } },
  { id: 'ratio', title: 'Ratio analysis', fields: [['ca', 'Current assets', 500000], ['cl', 'Current liabilities', 250000], ['inv', 'Inventory', 150000], ['debt', 'Total debt', 400000], ['eq', 'Equity', 600000], ['sales', 'Sales', 1200000], ['gp', 'Gross profit', 300000], ['np', 'Net profit', 120000], ['cogs', 'Cost of goods sold', 900000]],
    run: (v) => [['Current ratio', r2(v.ca / v.cl)], ['Quick ratio', r2((v.ca - v.inv) / v.cl)], ['Debt to equity', r2(v.debt / v.eq)], ['Gross profit %', pct((v.gp / v.sales) * 100)], ['Net profit %', pct((v.np / v.sales) * 100)], ['Inventory turnover (times)', r2(v.cogs / v.inv)]] },
  { id: 'emi', title: 'EMI', fields: [['p', 'Loan amount', 1000000], ['rate', 'Interest % p.a.', 9], ['months', 'Months', 60]],
    run: (v) => { const i = v.rate / 1200; const e = i === 0 ? v.p / v.months : (v.p * i * (1 + i) ** v.months) / ((1 + i) ** v.months - 1); return [['EMI', inr(e)], ['Total paid', inr(e * v.months)], ['Total interest', inr(e * v.months - v.p)]]; } },
  { id: 'interest', title: 'Simple and compound interest', fields: [['p', 'Principal', 100000], ['rate', 'Rate % p.a.', 10], ['years', 'Years', 3], ['n', 'Compounded per year', 1]],
    run: (v) => { const si = (v.p * v.rate * v.years) / 100; const a = v.p * (1 + v.rate / 100 / v.n) ** (v.n * v.years); return [['Simple interest', inr(si)], ['Compound amount', inr(a)], ['Compound interest', inr(a - v.p)]]; } },
  { id: 'pv', title: 'Present value and annuity', fields: [['cf', 'Cash flow', 10000], ['rate', 'Discount % p.a.', 10], ['n', 'Years', 5]],
    run: (v) => { const r = v.rate / 100; const ann = r === 0 ? v.cf * v.n : (v.cf * (1 - (1 + r) ** -v.n)) / r; return [['PV of single amount at year n', inr(v.cf / (1 + r) ** v.n)], ['PV of annuity (end of year)', inr(ann)], ['FV of annuity', inr(ann * (1 + r) ** v.n)]]; } },
  { id: 'bep', title: 'Break-even', fields: [['fc', 'Fixed costs', 200000], ['sp', 'Selling price per unit', 100], ['vc', 'Variable cost per unit', 60], ['units', 'Expected units', 6000]],
    run: (v) => { const cm = v.sp - v.vc; const u = v.fc / cm; return [['Contribution per unit', inr(cm)], ['P/V ratio', pct((cm / v.sp) * 100)], ['Break-even units', num(u)], ['Break-even sales', inr(u * v.sp)], ['Margin of safety', pct(((v.units - u) / v.units) * 100)]]; } },
  { id: 'costsheet', title: 'Cost sheet', fields: [['mat', 'Direct materials', 300000], ['lab', 'Direct labour', 200000], ['exp', 'Direct expenses', 20000], ['fo', 'Factory overheads', 100000], ['ao', 'Administration overheads', 50000], ['so', 'Selling overheads', 40000]],
    run: (v) => { const prime = v.mat + v.lab + v.exp; const fc = prime + v.fo; const coc = fc + v.ao; return [['Prime cost', inr(prime)], ['Factory cost', inr(fc)], ['Cost of production', inr(coc)], ['Cost of sales', inr(coc + v.so)]]; } },
  { id: 'drawings', title: 'Interest on drawings (simple)', fields: [['d', 'Drawings', 120000], ['rate', 'Rate % p.a.', 12], ['months', 'Average months outstanding', 6]],
    run: (v) => [['Interest on drawings', inr((v.d * v.rate * v.months) / 1200)]] },
];
