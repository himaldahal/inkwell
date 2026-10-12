/* Small, pure calculators. Each returns rows of [label, value]. Amounts are rounded to 2 places. */
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const fm = (x) => (Number.isFinite(x) ? r2(x).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-');
const pct = (x) => (Number.isFinite(x) ? r2(x) + '%' : '-');
export const CALCS = [
  { id: 'slm', title: 'Depreciation (straight line)', fields: [['cost', 'Cost', 100000], ['salvage', 'Scrap value', 10000], ['life', 'Life (years)', 5]],
    run: (v) => { const d = (v.cost - v.salvage) / v.life; return [['Annual depreciation', fm(d)], ['Rate on cost', pct((d / v.cost) * 100)]]; } },
  { id: 'wdv', title: 'Depreciation (written down value)', fields: [['cost', 'Cost', 100000], ['rate', 'Rate % p.a.', 15], ['years', 'Years', 3]],
    run: (v) => { let b = v.cost; const rows = []; for (let y = 1; y <= v.years; y++) { const d = (b * v.rate) / 100; b -= d; rows.push([`Year ${y} depreciation / closing`, `${fm(d)} / ${fm(b)}`]); } return rows; } },
  { id: 'ratio', title: 'Ratio analysis', fields: [['ca', 'Current assets', 500000], ['cl', 'Current liabilities', 250000], ['inv', 'Inventory', 150000], ['debt', 'Total debt', 400000], ['eq', 'Equity', 600000], ['sales', 'Sales', 1200000], ['gp', 'Gross profit', 300000], ['np', 'Net profit', 120000], ['cogs', 'Cost of goods sold', 900000]],
    run: (v) => [['Current ratio', r2(v.ca / v.cl)], ['Quick ratio', r2((v.ca - v.inv) / v.cl)], ['Debt to equity', r2(v.debt / v.eq)], ['Gross profit %', pct((v.gp / v.sales) * 100)], ['Net profit %', pct((v.np / v.sales) * 100)], ['Inventory turnover', r2(v.cogs / v.inv)]] },
  { id: 'emi', title: 'EMI', fields: [['p', 'Loan amount', 1000000], ['rate', 'Interest % p.a.', 9], ['months', 'Months', 60]],
    run: (v) => { const i = v.rate / 1200; const e = i === 0 ? v.p / v.months : (v.p * i * (1 + i) ** v.months) / ((1 + i) ** v.months - 1); return [['EMI', fm(e)], ['Total paid', fm(e * v.months)], ['Total interest', fm(e * v.months - v.p)]]; } },
  { id: 'interest', title: 'Simple and compound interest', fields: [['p', 'Principal', 100000], ['rate', 'Rate % p.a.', 10], ['years', 'Years', 3], ['n', 'Compounded per year', 1]],
    run: (v) => { const si = (v.p * v.rate * v.years) / 100; const a = v.p * (1 + v.rate / 100 / v.n) ** (v.n * v.years); return [['Simple interest', fm(si)], ['Compound amount', fm(a)], ['Compound interest', fm(a - v.p)]]; } },
  { id: 'gst', title: 'GST', fields: [['amt', 'Amount', 10000], ['rate', 'GST rate %', 18], ['incl', 'Amount includes GST? (1 = yes, 0 = no)', 0]],
    run: (v) => { const base = v.incl ? v.amt / (1 + v.rate / 100) : v.amt; const g = (base * v.rate) / 100; return [['Taxable value', fm(base)], ['GST', fm(g)], ['CGST + SGST (each)', fm(g / 2)], ['Invoice total', fm(base + g)]]; } },
  { id: 'tds', title: 'TDS quick calc', fields: [['amt', 'Payment amount', 50000], ['rate', 'TDS rate %', 10]],
    run: (v) => { const t = (v.amt * v.rate) / 100; return [['TDS to deduct', fm(t)], ['Net payable', fm(v.amt - t)]]; } },
  { id: 'pv', title: 'Present value and annuity', fields: [['cf', 'Cash flow', 10000], ['rate', 'Discount % p.a.', 10], ['n', 'Years', 5]],
    run: (v) => { const r = v.rate / 100; const ann = r === 0 ? v.cf * v.n : (v.cf * (1 - (1 + r) ** -v.n)) / r; return [['PV of single amount at year n', fm(v.cf / (1 + r) ** v.n)], ['PV of annuity (end of year)', fm(ann)], ['FV of annuity', fm(ann * (1 + r) ** v.n)]]; } },
  { id: 'bep', title: 'Break-even', fields: [['fc', 'Fixed costs', 200000], ['sp', 'Selling price per unit', 100], ['vc', 'Variable cost per unit', 60], ['units', 'Expected units', 6000]],
    run: (v) => { const cm = v.sp - v.vc; const u = v.fc / cm; return [['Contribution per unit', fm(cm)], ['P/V ratio', pct((cm / v.sp) * 100)], ['Break-even units', fm(u)], ['Break-even sales', fm(u * v.sp)], ['Margin of safety', pct(((v.units - u) / v.units) * 100)]]; } },
  { id: 'costsheet', title: 'Cost sheet', fields: [['mat', 'Direct materials', 300000], ['lab', 'Direct labour', 200000], ['exp', 'Direct expenses', 20000], ['fo', 'Factory overheads', 100000], ['ao', 'Administration overheads', 50000], ['so', 'Selling overheads', 40000]],
    run: (v) => { const prime = v.mat + v.lab + v.exp; const fc = prime + v.fo; const coc = fc + v.ao; return [['Prime cost', fm(prime)], ['Factory cost', fm(fc)], ['Cost of production', fm(coc)], ['Cost of sales', fm(coc + v.so)]]; } },
  { id: 'drawings', title: 'Interest on drawings (simple)', fields: [['d', 'Drawings', 120000], ['rate', 'Rate % p.a.', 12], ['months', 'Average months outstanding', 6]],
    run: (v) => [['Interest on drawings', fm((v.d * v.rate * v.months) / 1200)]] },
];
