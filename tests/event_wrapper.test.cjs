// 全文GASのAPI接続と公開版の秘匿化を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../gas/Code.events.paste-ready.gs'), 'utf8');
assert.ok(source.includes("const APP_TOKEN_DEFAULT = '';"));
assert.ok(source.includes("const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';"));
assert.ok(source.includes('function collectAutoEvents()'));
let opened = 0;
const context = vm.createContext({
  PropertiesService:{getScriptProperties:() => ({getProperty:key => key === 'APP_TOKEN' ? 'test-token' : null})},
  SpreadsheetApp:{openById:() => { opened++; return {getSheetByName:() => null}; }},
  Utilities:{formatDate:() => '2026-10-08'},
  ContentService:{MimeType:{JSON:'json'}, createTextOutput:value => ({value, setMimeType(){return this;}})},
});
vm.runInContext(source, context);
const get = token => JSON.parse(context.doGet({parameter:{action:'getAutoEvents', token}}).value);
assert.equal(get('wrong').error, 'unauthorized');
assert.equal(opened, 0);
assert.deepEqual(get('test-token'), {events:[], judgements:[], status:[], updatedAt:''});
assert.equal(opened, 1);
console.log('PASS: イベントAPIの合言葉認証、既存GASへの接続、公開版の秘匿化');
