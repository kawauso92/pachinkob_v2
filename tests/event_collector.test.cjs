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
// 前回1件以上あった収集元が0件になったら、p100以外でも警告する。
// ただしエイムスター・たま道場は0件が普通なので、0件では警告しない（失敗は警告）。
context.warnStatuses = [
  {source:'スロパチ公式', result:'成功', count:0, lastDate:'', error:'', previousCount:25},
  {source:'エイムスター', result:'成功', count:0, lastDate:'', error:'', previousCount:2},
  {source:'たま道場', result:'成功', count:0, lastDate:'', error:'', previousCount:2},
  {source:'エイムスター', result:'失敗', count:0, lastDate:'', error:'HTTP 500'},
  {source:'ジャンバリ', result:'成功', count:3, lastDate:'2026-10-20', error:'', previousCount:3},
];
assert.deepEqual(run("warnStatuses.map(item => eventStatusWarning(item, '2026-10-08'))"),
  [true, false, false, true, false]);

// G列は「最後に1件以上取れたときの件数」。0件・失敗では前の値を引き継ぐ。
assert.equal(run("eventNextPreviousCount({result:'成功', count:25}, 0)"), 25);
assert.equal(run("eventNextPreviousCount({result:'成功', count:0}, 25)"), 25);
assert.equal(run("eventNextPreviousCount({result:'失敗', count:0}, 25)"), 25);
assert.equal(run("eventNextPreviousCount({result:'成功', count:30}, 25)"), 30);
context.next = 0;
function nextCount(result, count) {
  context.next = run(`eventNextPreviousCount({result:'${result}', count:${count}}, ${context.next})`);
  return context.next;
}
assert.deepEqual([nextCount('成功',25), nextCount('成功',0), nextCount('成功',0)], [25,25,25]);
context.next = 0;
assert.deepEqual([nextCount('成功',25), nextCount('失敗',0), nextCount('成功',0)], [25,25,25]);
context.next = 0;
assert.deepEqual([nextCount('成功',25), nextCount('成功',0), nextCount('成功',30)], [25,25,30]);
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
// G列が無い既存シート（6列）は、D列の値を前回件数として引き継ぐ
context.statusSheet6 = sheet('6列テスト');
context.statusSheet6.rows.push(['収集元','最終実行','結果(成功|失敗)','件数','最終日付','エラー']);
context.statusSheet6.rows.push(['スロパチ公式','前回','成功',25,'2026-10-20','']);
assert.equal(run('eventPreviousCounts(statusSheet6).get("スロパチ公式")'), 25);
context.statusSheet6.rows.push(['ジャンバリ','前回','成功',0,'','',0]);
assert.equal(run('eventPreviousCounts(statusSheet6).get("ジャンバリ")'), 0);

// 連続した収集でG列が「最後に1件以上取れた件数」を保つ
context.seqSheet = sheet('連続テスト');
context.seqSheet.rows.push(['収集元','最終実行','結果(成功|失敗)','件数','最終日付','エラー','前回件数']);
function writeStatus(result, count) {
  context.statusItem = {source:'スロパチ公式', result, count,
    lastDate: count ? '2026-10-30' : '', error:''};
  context.statusPrev = vm.runInContext('eventPreviousCounts(seqSheet)', context);
  locked = true;
  try { vm.runInContext('eventWriteStatuses(seqSheet, [statusItem], "now", statusPrev)', context); }
  finally { locked = false; }
  return Number(context.seqSheet.rows[1][6]);
}
function resetSeq() {
  context.seqSheet.rows.length = 0;
  context.seqSheet.rows.push(['収集元','最終実行','結果(成功|失敗)','件数','最終日付','エラー','前回件数']);
}
assert.deepEqual([writeStatus('成功',25), writeStatus('成功',0), writeStatus('成功',0)], [25,25,25]);
resetSeq();
assert.deepEqual([writeStatus('成功',25), writeStatus('失敗',0), writeStatus('成功',0)], [25,25,25]);
resetSeq();
assert.deepEqual([writeStatus('成功',25), writeStatus('成功',0), writeStatus('成功',30)], [25,25,30]);
assert.equal(run("eventStatusWarning({source:'スロパチ公式', result:'成功', count:0, previousCount:25}, '2026-10-30')"), true);
assert.equal(run("eventStatusWarning({source:'スロパチ公式', result:'成功', count:30, previousCount:25}, '2026-10-30')"), false);
assert.equal(run("eventStatusWarning({source:'エイムスター', result:'成功', count:0, previousCount:2}, '2026-10-30')"), false);

const responses = new Map([
  ['https://pachisuro100.com/osaka-schedule/', '<div class="event-section"><div class="event-header"><strong>2026/10/11</strong><span class="badge badge-survey">取材</span></div><div class="store-name"><strong>店A</strong></div><div class="event-info">・新取材（媒体）</div></div>'],
  ['https://aims777.com/syuzai/aimstar_gyoku/', '<a class="c-schedule__item"><span class="c-schedule__date">10月11日</span><span class="c-schedule__area">大阪</span><span class="c-schedule__title">店B</span></a>'],
  ['https://aims777.com/syuzai/aimstar_chogyoku/', ''],
  ['https://jb-portal.com/schedule/?report_id=4', null],
  ['https://tama-dojo.com/', ''],
]);
context.SPREADSHEET_ID = 'test-id';
context.SpreadsheetApp = {openById: () => ({getSheetByName: name => sheets.get(name), insertSheet: name => sheet(name)})};
context.Utilities = {
  formatDate: (_date, _zone, pattern) => pattern === 'yyyy-MM-dd' ? '2026-10-08' : '2026-10-08 06:10:00',
  sleep: ms => { calls.push(['sleep', ms]); assert.equal(locked, false); },
};
context.PropertiesService = {getScriptProperties: () => ({getProperty: key => ({
  SLOPACHI_RELAY_URL: 'https://relay.test/api/slopachi',
  SLOPACHI_RELAY_TOKEN: 'secret',
}[key] || null)})};
context.UrlFetchApp = {fetch: (url, options) => {
  calls.push(['fetch', url]);
  assert.equal(locked, false);
  assert.equal(options.muteHttpExceptions, true);
  if (url.indexOf('https://relay.test/api/slopachi?') === 0) {
    const page = /[?&]page=([^&]+)/.exec(url)[1];
    assert.equal(options.headers['X-Relay-Token'], 'secret');
    assert.ok(url.indexOf('token=') < 0);
    return {getResponseCode: () => 200,
      getContentText: () => JSON.stringify({status:200, page, fetchedAt:'2026-10-08T00:00:00Z', html:'<html></html>'})};
  }
  assert.ok(options.headers['User-Agent'].includes('Chrome/136'));
  const html = responses.get(url);
  return {getResponseCode: () => html === null ? 500 : 200, getContentText: () => html};
}};
context.AutoHoshu = {withLock: fn => { assert.equal(locked, false); locked = true; try { return fn(); } finally { locked = false; } }};
const result = run('collectAutoEvents()');
assert.equal(result.success, true);
assert.equal(result.sources.length, 5);
assert.equal(result.sources.find(item => item.source === 'ジャンバリ').result, '失敗');
assert.equal(calls.filter(item => item[0] === 'fetch').length, 9);
assert.equal(calls.filter(item => item[0] === 'sleep').length, 8);
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
assert.equal(sheet('収集状態').rows[0][6], '前回件数');
assert.equal(sheet('収集状態').rows[1][6], 1); // パチスロ100 の前回件数
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
