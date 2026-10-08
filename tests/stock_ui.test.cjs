const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({window:{addEventListener(){}}, document:{addEventListener(){},getElementById(){return {}},querySelectorAll(){return []}}, console, setTimeout(){}});
vm.runInContext(script, context);
const call = expression => vm.runInContext(expression, context);

assert.ok(html.includes('id="nav-stock"'));
assert.ok(html.includes('id="tab-stock"'));
assert.ok(html.includes('<div class="icon">🏦</div><div>貯玉</div>'));
assert.equal(call('stockRedemptionPreview(3000, 28)'), 840);
assert.equal(call('stockRedemptionPreview(1000, 27.78)'), 278);
assert.equal(call('stockRedemptionPreview(1000, 27.75)'), 278);
assert.throws(() => call('stockRedemptionPreview(1500, 28)'), /1000/);
assert.throws(() => call('stockRedemptionPreview(1000, 0)'), /交換率/);
const gasContext = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/StockLedger.gs'), 'utf8'), gasContext);
for (const amount of [1000, 3000, 10000]) {
  for (const rate of [5.6, 27.75, 27.78, 28]) {
    gasContext.amount = amount;
    gasContext.rate = rate;
    assert.equal(call(`stockRedemptionPreview(${amount}, ${rate})`), vm.runInContext('stockRedemptionBalls(amount, rate)', gasContext));
  }
}
context.input = {date:'2026-10-08', shop:'A', card:'自分', type:'手動', balls:'-250', memo:'補正'};
assert.equal(call('stockBuildRequest(input).balls'), -250);
assert.equal(call('stockBuildRequest(input).action'), 'addStockEntry');
console.log('PASS: 貯玉タブ、換金プレビュー、送信内容');
