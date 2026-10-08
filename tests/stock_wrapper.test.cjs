const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../gas/Code.stock.paste-ready.gs'), 'utf8');
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
assert.equal(post('test-token', {...work, stockStart:''}).success, true);
assert.equal(records.length, 2);
assert.equal(values.length, 3);
assert.equal(post('test-token', {...work, stockStart:'1.5'}).success, false);
assert.equal(records.length, 2);
failStockAppend = true;
assert.equal(post('test-token', work).success, false);
assert.equal(records.length, 2);
assert.equal(values.length, 3);
assert.equal(locked, false);
assert.equal(post('test-token', {...work, stockEnd:'', choTamaInvest:400}).success, true);
assert.equal(values.at(-1)[6], -100);
assert.equal(post('test-token', {...work, stockEnd:'', choTamaInvest:''}).success, true);
assert.equal(values.at(-1)[6], 300);
assert.equal(post('test-token', {...work, stockEnd:'800', choTamaInvest:400}).success, true);
assert.equal(values.at(-1)[6], 100);
console.log('PASS: GAS認証、同一ロック、GET/POST接続');
