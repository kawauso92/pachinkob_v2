const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../gas/StockLedger.gs'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const call = (expression) => vm.runInContext(expression, context);

assert.equal(call('stockRedemptionBalls(3000, 28)'), 840);
assert.equal(call('stockRedemptionBalls(1000, 27.78)'), 278);
assert.equal(call('stockRedemptionBalls(1000, 27.75)'), 278);
assert.throws(() => call('stockRedemptionBalls(1500, 28)'), /1000/);
assert.throws(() => call('stockRedemptionBalls(1000, 0)'), /交換率/);
assert.throws(() => call('stockRedemptionBalls(-1000, 28)'), /1000/);

const rows = [
  {shop:'A', card:'自分', balls:1000, status:'有効'},
  {shop:'A', card:'自分', balls:-250, status:'有効'},
  {shop:'A', card:'自分', balls:300, status:'取消'},
  {shop:'A', card:'友達', balls:250, status:'有効'},
  {shop:'B', card:'自分', balls:90, status:'有効'},
];
context.sampleRows = rows;
assert.deepEqual(JSON.parse(JSON.stringify(call('stockBalancesFromRows(sampleRows)'))), [
  {shop:'A', card:'友達', balance:250},
  {shop:'A', card:'自分', balance:750},
  {shop:'B', card:'自分', balance:90},
]);

context.shops = [{name:'A', kokan:28}];
context.entry = {date:'2026-10-08', shop:'A', card:'自分', type:'手動', balls:500, memo:'補正'};
assert.equal(call('stockValidateEntry(entry, shops).balls'), 500);
assert.throws(() => call('stockValidateEntry({...entry, balls:1.5}, shops)'), /玉数/);
assert.throws(() => call('stockValidateEntry({...entry, shop:"不明"}, shops)'), /店/);
assert.throws(() => call('stockValidateEntry({...entry, card:""}, shops)'), /カード/);
assert.throws(() => call('stockValidateEntry({...entry, memo:"x".repeat(501)}, shops)'), /メモ/);
assert.throws(() => call('stockValidateEntry({...entry, type:"稼働"}, shops)'), /種別/);
assert.equal(call('stockValidateEntry({...entry, type:"換金", amount:3000, balls:9999}, shops).balls'), -840);
assert.throws(() => call('stockValidateEntry({...entry, type:"換金", amount:1500}, shops)'), /1000/);
assert.throws(() => call('stockValidateEntry({...entry, type:"棚卸し", actualBalance:-1}, shops)'), /実残高/);
assert.throws(() => call('stockValidateEntry({...entry, date:"2026-02-30"}, shops)'), /日付/);
assert.throws(() => call('stockValidateEntry({...entry, balls:"1e3"}, shops)'), /玉数/);
for (const prefix of ['=', '+', '-', '@']) {
  context.unsafeText = prefix + '例';
  assert.equal(call('stockSheetText(unsafeText)'), "'" + context.unsafeText);
  assert.equal(call('stockDisplayText(stockSheetText(unsafeText))'), context.unsafeText);
}
context.unsafeText = "'=例";
assert.equal(call('stockDisplayText(stockSheetText(unsafeText))'), context.unsafeText);

const values = [Array.from({length:12}, (_, index) => index === 0 ? 'ID' : '')];
let sequence = 0;
let failVoidRow = 0;
const sheet = {
  getLastRow: () => values.length,
  getRange(row, column, height = 1, width = 1) {
    return {
      getValues: () => values.slice(row - 1, row - 1 + height).map(item => item.slice(column - 1, column - 1 + width)),
      setValues: update => update.forEach((item, index) => {
        if (row === failVoidRow && column === 11 && item[0] === '取消') { failVoidRow = 0; throw new Error('書き込み失敗'); }
        while (values.length < row + index) values.push(Array(12).fill(''));
        item.forEach((value, offset) => { values[row + index - 1][column + offset - 1] = value; });
      }),
    };
  },
};
context.SPREADSHEET_ID = 'test';
context.SpreadsheetApp = {openById: () => ({getSheetByName: () => sheet})};
context.Utilities = {formatDate: () => '2026-10-08 12:00:00', getUuid: () => `id-${++sequence}`};
context.getMasters = () => ({shops:[{name:'A', kokan:28}]});
context.work = {date:'2026-10-08', shop:'A', stockCard:'代1', stockStart:'1000', stockEnd:'800',
  stockRecoverRaw:'300', watashita:200, moratta:100};
assert.equal(call('stockWorkEntry(work).balls'), 100);
assert.equal(call('stockWorkEntry({...work, stockEnd:"", choTamaInvest:400}).balls'), -100);
assert.equal(call('stockWorkEntry({...work, stockStart:"100", stockEnd:"", stockRecoverRaw:"", choTamaInvest:200}).balls'), -200);
assert.equal(call('stockWorkEntry({...work, stockEnd:"", choTamaInvest:""}).balls'), 300);
assert.equal(call('stockWorkEntry({...work, stockEnd:"800", choTamaInvest:400}).balls'), 100);
assert.equal(call('stockWorkEntry({...work, stockStart:""})'), null);
assert.equal(call('stockWorkEntry({...work, stockStart:"0", stockEnd:"0", stockRecoverRaw:"0"}).balls'), 0);
context.longMemo = '長'.repeat(501);
assert.equal(call('stockWorkEntry({...work, memo:longMemo}).memo.length'), 500);
context.request = {action:'addStockEntry', date:'2026-10-08', shop:'A', card:'自分', type:'手動', balls:1000};
assert.equal(call('stockHandlePost(request).success'), true);
context.request = {action:'transferStock', date:'2026-10-08', shop:'A', fromCard:'自分', toCard:'友達', balls:250};
assert.equal(call('stockHandlePost(request).ids.length'), 2);
assert.equal(values[2][8], values[3][8]);
assert.equal(call('stockGetBalances().balances.find(item => item.card === "自分").balance'), 750);
context.request = {action:'voidStockEntry', id:values[2][0]};
assert.equal(call('stockHandlePost(request).success'), true);
assert.equal(values[2][10], '取消');
assert.equal(values[3][10], '取消');
assert.equal(call('stockGetBalances().balances.find(item => item.card === "自分").balance'), 1000);
context.request = {action:'editStockEntry', id:values[1][0], date:'2026-10-08', shop:'A', card:'自分', type:'手動', balls:700};
assert.equal(call('stockHandlePost(request).success'), true);
assert.equal(values[1][10], '取消');
assert.equal(call('stockGetBalances().balances.find(item => item.card === "自分").balance'), 700);
context.request = {action:'addStockEntry', date:'2026-10-08', shop:'A', card:'自分', type:'棚卸し', actualBalance:900};
assert.equal(call('stockHandlePost(request).entries[0].balls'), 200);
context.request = {action:'addStockEntry', date:'2026-10-08', shop:'A', card:'自分', type:'換金', amount:1000, balls:1};
assert.equal(call('stockHandlePost(request).entries[0].balls'), -280);
context.request = {action:'transferStock', date:'2026-10-08', shop:'A', fromCard:'自分', toCard:'友達', balls:100};
call('stockHandlePost(request)');
const pairStart = values.length - 2;
failVoidRow = pairStart + 2;
context.request = {action:'voidStockEntry', id:values[pairStart][0]};
assert.throws(() => call('stockHandlePost(request)'), /書き込み失敗/);
assert.equal(values[pairStart][10], '有効');
assert.equal(values[pairStart + 1][10], '有効');
context.request = {action:'editStockEntry', id:values[pairStart][0], date:'2026-10-08', shop:'A', type:'手動', card:'自分', balls:150};
assert.throws(() => call('stockHandlePost(request)'), /移動/);
context.request = {action:'editStockEntry', id:values[pairStart][0], date:'2026-10-08', shop:'A', type:'移動', fromCard:'自分', toCard:'友達', balls:150};
assert.equal(call('stockHandlePost(request).ids.length'), 2);
assert.equal(values[pairStart][10], '取消');
assert.equal(values[pairStart + 1][10], '取消');
assert.equal(call('stockGetBalances().balances.find(item => item.card === "自分").balance'), 470);
context.request = {action:'addStockEntry', date:'2026-10-08', shop:'A', card:'=カード', type:'手動', balls:10, memo:'@メモ'};
assert.equal(call('stockHandlePost(request).success'), true);
assert.equal(values.at(-1)[4], "'=カード");
assert.equal(values.at(-1)[9], "'@メモ");
assert.equal(call('stockGetLedger().rows.at(-1).card'), '=カード');
assert.equal(call('stockGetLedger().rows.at(-1).memo'), '@メモ');

console.log('PASS: 貯玉台帳の残高集計、換金、入力検証、移動、棚卸し、修正、取消');
