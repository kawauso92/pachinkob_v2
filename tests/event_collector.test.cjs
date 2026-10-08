// 収集差分、停止検知、公開APIとGAS接続の回帰テスト。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.join(__dirname, '../gas');
const parser = fs.readFileSync(path.join(base, 'EventParsers.gs'), 'utf8');
const collector = fs.readFileSync(path.join(base, 'EventCollector.gs'), 'utf8');
const context = vm.createContext({});
vm.runInContext(parser + '\n' + collector, context);
const run = expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
context.stockSheetText = value => /^[=+\-@']/.test(value) ? "'" + value : value;
context.stockDisplayText = value => /^'[=+\-@']/.test(value) ? value.slice(1) : value;
const record = (date, event, source = 'パチスロ100') => ({
  date, store:'店A', area:'大阪市', kind:'取材', event, media:'媒体', note:'補足', source,
  source_url:'https://example.test/'
});
context.oldRows = [
  {rowNumber:2, key:'2026-10-10|店A|継続', ...record('2026-10-10', '継続'), firstSeen:'前回', lastSeen:'前回', status:'有効'},
  {rowNumber:3, key:'2026-10-11|店A|消失', ...record('2026-10-11', '消失'), firstSeen:'前回', lastSeen:'前回', status:'有効'},
  {rowNumber:4, key:'2026-10-07|店A|過去', ...record('2026-10-07', '過去'), firstSeen:'前回', lastSeen:'前回', status:'有効'},
  {rowNumber:5, key:'2026-10-12|店A|失敗元', ...record('2026-10-12', '失敗元', 'エイムスター'), firstSeen:'前回', lastSeen:'前回', status:'有効'},
  {rowNumber:6, key:'2026-10-13|店A|復活', ...record('2026-10-13', '復活'), firstSeen:'前回', lastSeen:'前回', status:'消失'},
];
context.newRecords = [record('2026-10-10', '継続'), record('2026-10-13', '復活'),
  record('2026-10-14', '新規'), record('2026-10-07', '過去')];
const diff = run("eventDiff(oldRows, newRecords, ['パチスロ100'], '今回', '2026-10-08')");
assert.deepEqual(diff.added.map(item => item.key), ['2026-10-14|店A|新規']);
assert.deepEqual(diff.updated.map(item => [item.rowNumber, item.firstSeen, item.lastSeen, item.status]),
  [[2, '前回', '今回', '有効'], [6, '前回', '今回', '有効']]);
assert.deepEqual(diff.disappeared.map(item => item.rowNumber), [3]);
assert.equal(diff.disappeared[0].status, '消失');
assert.equal(run("eventDiff(oldRows, [], [], '今回', '2026-10-08')").disappeared.length, 0);

context.statuses = [
  {source:'パチスロ100', result:'成功', count:0, lastDate:'', error:''},
  {source:'パチスロ100', result:'成功', count:10, lastDate:'2026-10-10', error:''},
  {source:'パチスロ100', result:'成功', count:10, lastDate:'2026-10-11', error:''},
  {source:'ジャンバリ', result:'失敗', count:0, lastDate:'', error:'HTTP 500'},
];
assert.deepEqual(run("statuses.map(item => eventStatusWarning(item, '2026-10-08'))"), [true, true, false, true]);
context.apiRows = [
  { ...record('2026-09-07', '範囲外'), status:'有効', lastSeen:'a'},
  { ...record('2026-09-08', '開始'), status:'有効', lastSeen:'b'},
  { ...record('2026-11-08', '終了'), status:'有効', lastSeen:'c'},
  { ...record('2026-11-10', '範囲外'), status:'有効', lastSeen:'d'},
  { ...record('2026-10-10', '消失'), status:'消失', lastSeen:'e'},
];
assert.deepEqual(run("eventEventsForApp(apiRows, '2026-10-09').map(item => item.event)"), ['開始', '終了']);
assert.equal(run("eventSafe('=取材')"), "'=取材");
assert.equal(run("eventCell(\"'=取材\")"), '=取材');

// 外部取得はロックの外。失敗元の既存行は変えず、状態のみ失敗にする。
const calls = [];
let locked = false;
const sheets = new Map();
function sheet(name) {
  if (sheets.has(name)) return sheets.get(name);
  const rows = [];
  const value = {
    rows,
    getLastRow: () => rows.length,
    getRange(row, column, height, width) {
      return {
        getValues: () => rows.slice(row - 1, row - 1 + height).map(item => item.slice(column - 1, column - 1 + width)),
        setValues: input => {
          assert.equal(locked, true);
          input.forEach((item, index) => { rows[row + index - 1] = item.slice(); });
        },
      };
    },
  };
  sheets.set(name, value);
  return value;
}
const responses = new Map([
  ['https://pachisuro100.com/osaka-schedule/', '<div class="event-section"><div class="event-header"><strong>2026/10/11</strong><span class="badge badge-survey">取材</span></div><div class="store-name"><strong>店A</strong></div><div class="event-info">・新取材（媒体）</div></div>'],
  ['https://aims777.com/syuzai/aimstar_gyoku/', '<a class="c-schedule__item"><span class="c-schedule__date">10月11日</span><span class="c-schedule__area">大阪</span><span class="c-schedule__title">店B</span></a>'],
  ['https://aims777.com/syuzai/aimstar_chogyoku/', ''],
  ['https://jb-portal.com/schedule/?report_id=5', null],
  ['https://tama-dojo.com/', ''],
]);
context.SPREADSHEET_ID = 'test-id';
context.SpreadsheetApp = {openById: () => ({getSheetByName: name => sheets.get(name), insertSheet: name => sheet(name)})};
context.Utilities = {
  formatDate: (_date, _zone, pattern) => pattern === 'yyyy-MM-dd' ? '2026-10-08' : '2026-10-08 06:10:00',
  sleep: ms => { calls.push(['sleep', ms]); assert.equal(locked, false); },
};
context.UrlFetchApp = {fetch: (url, options) => {
  calls.push(['fetch', url]);
  assert.equal(locked, false);
  assert.equal(options.muteHttpExceptions, true);
  assert.ok(options.headers['User-Agent'].includes('Chrome/136'));
  const html = responses.get(url);
  return {getResponseCode: () => html === null ? 500 : 200, getContentText: () => html};
}};
context.AutoHoshu = {withLock: fn => { assert.equal(locked, false); locked = true; try { return fn(); } finally { locked = false; } }};
const result = run('collectAutoEvents()');
assert.equal(result.success, true);
assert.equal(result.sources.length, 4);
assert.equal(result.sources.find(item => item.source === 'ジャンバリ').result, '失敗');
assert.equal(calls.filter(item => item[0] === 'fetch').length, 5);
assert.equal(calls.filter(item => item[0] === 'sleep').length, 4);
assert.equal(sheet('自動イベント').rows.length, 3);
assert.equal(sheet('取材判定').rows.length, 3);
const api = run('getAutoEventsForApp()');
assert.deepEqual(api.events.map(item => item.event), ['新取材', 'エイムスター玉']);
assert.equal(api.judgements.length, 2);
assert.equal(api.status.find(item => item.source === 'ジャンバリ').warning, true);
assert.equal(api.updatedAt, '2026-10-08 06:10:00');
run('collectAutoEvents()');
assert.equal(sheet('自動イベント').rows.length, 3);
assert.equal(sheet('取材判定').rows.length, 3);
responses.set('https://pachisuro100.com/osaka-schedule/', '');
const stopped = run('collectAutoEvents()');
assert.equal(stopped.sources.find(item => item.source === 'パチスロ100').result, '失敗');
assert.equal(sheet('自動イベント').rows[1][12], '有効');
assert.equal(sheet('自動イベント').rows.length, 3);

const triggerCalls = [];
const oldTrigger = {getHandlerFunction: () => 'collectAutoEvents'};
const unrelated = {getHandlerFunction: () => 'otherJob'};
context.ScriptApp = {
  getProjectTriggers: () => [oldTrigger, unrelated],
  deleteTrigger: trigger => triggerCalls.push(['delete', trigger]),
  newTrigger: handler => {
    triggerCalls.push(['new', handler]);
    return {timeBased() { return this; }, everyDays(days) { triggerCalls.push(['days', days]); return this; },
      atHour(hour) { triggerCalls.push(['hour', hour]); return this; },
      inTimezone(zone) { triggerCalls.push(['zone', zone]); return this; },
      create() { triggerCalls.push(['create']); }};
  },
};
vm.runInContext('setupAutoEventTrigger()', context);
assert.deepEqual(triggerCalls.map(item => item[0]), ['delete', 'new', 'days', 'hour', 'zone', 'create']);
assert.equal(triggerCalls[0][1], oldTrigger);
assert.equal(triggerCalls[2][1], 1);
assert.equal(triggerCalls[3][1], 6);
assert.equal(triggerCalls[4][1], 'Asia/Tokyo');

console.log('PASS: イベント差分、停止検知、31日API、外部取得とロック、失敗元保持');
