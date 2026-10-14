const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../gas', process.env.STOCK_GAS_FILE || 'Code.stock.paste-ready.gs'), 'utf8');
assert.ok(source.includes("const APP_TOKEN_DEFAULT = '';"));
assert.ok(source.includes("const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';"));
assert.ok(source.includes('公開リポジトリのためIDは載せない'));
const values = [Array(12).fill('')];
const records = [];
let opened = 0, locked = false, lockCount = 0, sequence = 0, failStockAppend = false;
const recordSheet = {
  getLastRow: () => records.length + 1,
  appendRow: row => { assert.equal(locked, true); records.push(row); },
  deleteRow: row => { assert.equal(locked, true); records.splice(row - 2, 1); },
  getRange: () => ({setNumberFormat(){}}),
};
const sheet = {
  getLastRow: () => values.length,
  getRange(row, column, height = 1, width = 1) {
    return {
      getValues: () => values.slice(row - 1, row - 1 + height).map(item => item.slice(column - 1, column - 1 + width)),
      setValues: update => {
        assert.equal(locked, true);
        if (failStockAppend && column === 1 && row > 1) { failStockAppend = false; throw new Error('台帳書込失敗'); }
        update.forEach((item, index) => {
          while (values.length < row + index) values.push(Array(12).fill(''));
          item.forEach((value, offset) => { values[row + index - 1][column + offset - 1] = value; });
        });
      },
    };
  },
};
const context = vm.createContext({
  SpreadsheetApp:{openById:() => { opened++; return {getSheetByName:name => name === '稼働記録' ? recordSheet : sheet}; }},
  PropertiesService:{getScriptProperties:() => ({getProperty:key => key === 'APP_TOKEN' ? 'test-token' : null})},
  LockService:{getScriptLock:() => ({waitLock(){ assert.equal(locked, false); locked = true; lockCount++; }, releaseLock(){ locked = false; }})},
  Utilities:{formatDate:() => '2026-10-08 12:00:00', getUuid:() => `test-id-${++sequence}`},
  ContentService:{MimeType:{JSON:'json'}, createTextOutput:value => ({value, setMimeType(){return this;}})},
});
vm.runInContext(source, context);
vm.runInContext("getMasters = () => ({shops:[{name:'A',kokan:28}]})", context);
vm.runInContext("calcHoshuDetail = () => ({final:0,koujo:0,rate:0,avgKitai:0}); timeToSerial = () => 0", context);
const post = (token, data) => JSON.parse(context.doPost({postData:{contents:JSON.stringify({...data, token})}}).value);
const get = (token, action) => JSON.parse(context.doGet({parameter:{token, action}}).value);

assert.equal(post('wrong', {action:'addStockEntry'}).error, 'unauthorized');
assert.equal(get('wrong', 'stockLedger').error, 'unauthorized');
assert.equal(opened, 0);
assert.equal(lockCount, 0);
assert.equal(post('test-token', {action:'addStockEntry', date:'2026-10-08', shop:'A', card:'自分', type:'手動', balls:500}).success, true);
assert.equal(get('test-token', 'stockBalances').balances[0].balance, 500);
assert.equal(get('test-token', 'stockLedger').rows.length, 1);
assert.equal(post('test-token', {action:'addStockEntry', date:'2026-10-08', shop:'A', card:'自分', type:'換金', amount:1500}).success, false);
assert.equal(lockCount, 4);
assert.equal(locked, false);
const work = {action:'submit', date:'2026-10-08', shop:'A', uchi:'自分', stockCard:'代1',
  stockStart:'1000', stockEnd:'800', stockRecoverRaw:'300', watashita:200, moratta:100, sagitama:50};
assert.equal(post('test-token', work).success, true);
assert.equal(records.length, 1);
assert.equal(records[0][14], 50);
assert.equal(values.at(-1)[4], '代1');
assert.equal(values.at(-1)[5], '稼働');
assert.equal(values.at(-1)[6], 100);
assert.equal(get('test-token', 'stockBalances').balances.find(item => item.card === '代1').balance, 1100);
assert.equal(values.at(-2)[5], '手動');
assert.equal(values.at(-2)[6], 1000);
assert.equal(values.at(-2)[8], '');
assert.equal(values.at(-1)[8], '');
const unchanged = JSON.stringify({values, records});
for (const stockStart of ['', '1.5', '1000']) {
  assert.equal(post('test-token', {...work, stockStart}).success, false);
  assert.equal(JSON.stringify({values, records}), unchanged);
}
// 台帳の項目を持たない旧クライアントの稼働送信は維持する。
assert.equal(post('test-token', {action:'submit', date:work.date, shop:'A', uchi:'自分'}).success, true);
assert.equal(records.length, 2);
failStockAppend = true;
assert.equal(post('test-token', {...work, stockStart:'1100'}).success, false);
assert.equal(records.length, 2);
assert.equal(values.length, 4);
assert.equal(locked, false);
// 新規カードの初回登録も台帳書込失敗時に稼働記録を残さない。
failStockAppend = true;
assert.equal(post('test-token', {...work, stockCard:'新規'}).success, false);
assert.equal(records.length, 2);
assert.equal(values.length, 4);
assert.equal(post('test-token', {...work, stockStart:'1100', stockEnd:'', choTamaInvest:400}).success, true);
assert.equal(values.at(-1)[6], -100);
assert.equal(post('test-token', {...work, stockStart:'1000', stockEnd:'', choTamaInvest:''}).success, true);
assert.equal(values.at(-1)[6], 300);
assert.equal(post('test-token', {...work, stockStart:'1300', stockEnd:'800', choTamaInvest:400}).success, true);
assert.equal(values.at(-1)[6], -200);
// 負残高の補正では過去の行をそのまま残す。
assert.equal(post('test-token', {action:'addStockEntry', date:work.date, shop:'A', card:'負残高', type:'手動', balls:-2400}).success, true);
const history = JSON.stringify(values);
const recordCount = records.length;
assert.match(post('test-token', {...work, stockCard:'負残高'}).error, /棚卸し/);
assert.equal(JSON.stringify(values), history);
assert.equal(records.length, recordCount);
const oldRows = values.length;
assert.equal(post('test-token', {action:'addStockEntry', date:work.date, shop:'A', card:'負残高', type:'棚卸し', actualBalance:7350}).success, true);
assert.equal(JSON.stringify(values.slice(0, oldRows)), history);
assert.equal(values.at(-1)[6], 9750);
assert.equal(get('test-token', 'stockBalances').balances.find(item => item.card === '負残高').balance, 7350);
assert.equal(post('test-token', {...work, stockCard:'負残高', stockStart:'7350', stockEnd:'7000'}).success, true);
console.log('PASS: GAS認証、初回残高、同一ロック、失敗時の巻き戻し、負残高の棚卸し');
