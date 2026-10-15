// appb のキャッシュ（端末に保存して、取り直すのは更新ボタンとその日はじめてのときだけ）のテスト。
// 判定の純関数・保存の読み書き・ヘッダーの文言・起動時の分岐を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// --- 端末の保存とDOMの代わり ---
const store = new Map();
const elements = new Map();
const el = () => ({
  textContent: '', innerHTML: '', value: '', hidden: false, disabled: false,
  dataset: {}, style: {}, open: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild() {}, setAttribute() {}, getAttribute() { return null; },
  querySelectorAll() { return []; }, querySelector() { return null; },
});
const context = vm.createContext({
  window: { addEventListener() {} },
  document: {
    addEventListener() {},
    getElementById(id) { if (!elements.has(id)) elements.set(id, el()); return elements.get(id); },
    createElement() { return el(); },
    querySelectorAll() { return []; },
  },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
  console,
  setTimeout() {},
});
vm.runInContext(script, context);
const call = expression => vm.runInContext(expression, context);
const plain = value => JSON.parse(JSON.stringify(value));

// =============================================
// shouldRefresh（取り直すかの判定）
// =============================================
// 一度も取っていない・時刻が壊れている → true
for (const v of [undefined, null, '', 'abc', NaN, {}, [], 'まだ', 0]) {
  assert.equal(call(`shouldRefresh(${JSON.stringify(v)})`), true, `未取得・壊れた値: ${JSON.stringify(v)}`);
}
// 数値にならない now も取り直す
assert.equal(call("shouldRefresh(1, 'abc')"), true);

// 日本時間（UTC+9）で見る。夏時間は無い
assert.equal(call('jstDateKey(0)'), '1970-01-01');
assert.equal(call("jstDateKey(Date.UTC(2026, 9, 14, 15, 0, 0))"), '2026-10-15', 'UTCの15時は日本時間の翌日0時');
assert.equal(call("jstDateKey(Date.UTC(2026, 9, 14, 14, 59, 0))"), '2026-10-14');
assert.equal(call("jstDateKey('abc')"), '');

// 同じ日（日本時間）
const jst10_15_0100 = 'Date.UTC(2026, 9, 14, 16, 0, 0)';   // 10/15 01:00 JST
const jst10_15_2300 = 'Date.UTC(2026, 9, 15, 14, 0, 0)';   // 10/15 23:00 JST
const jst10_16_0000 = 'Date.UTC(2026, 9, 15, 15, 0, 0)';   // 10/16 00:00 JST
assert.equal(call(`shouldRefresh(${jst10_15_0100}, ${jst10_15_2300})`), false, '同じ日は取り直さない');
// 日付またぎ（日本時間）
assert.equal(call(`shouldRefresh(${jst10_15_0100}, ${jst10_16_0000})`), true, '日本時間で日付が変われば取り直す');
assert.equal(call(`shouldRefresh(${jst10_16_0000}, ${jst10_15_0100})`), true, '逆（未来の保存）でも取り直す');
// Date でも数値でも同じ
assert.equal(call(`shouldRefresh(new Date(${jst10_15_0100}), new Date(${jst10_15_2300}))`), false);
assert.equal(call(`shouldRefresh(new Date(${jst10_15_0100}), new Date(${jst10_16_0000}))`), true);

// =============================================
// formatUpdatedAt（ヘッダーの「最終更新 M/D HH:MM」）
// =============================================
assert.equal(call('formatUpdatedAt(Date.UTC(2026, 9, 14, 16, 0, 0))'), '10/15 01:00');
assert.equal(call('formatUpdatedAt(Date.UTC(2026, 9, 15, 15, 0, 0))'), '10/16 00:00');
assert.equal(call('formatUpdatedAt(Date.UTC(2026, 9, 15, 6, 12, 0))'), '10/15 15:12');
assert.equal(call('formatUpdatedAt(0)'), '');
assert.equal(call("formatUpdatedAt('abc')"), '');
assert.equal(call('formatUpdatedAt(null)'), '');

// =============================================
// 保存の読み書き（壊れていたら null ＝ 取り直す）
// =============================================
store.clear();
assert.equal(call("readStoredJson('k')"), null, '保存が無ければ null');
call("writeStoredJson('k', { ts: 123, value: 'x' })");
assert.deepEqual(plain(call("readStoredJson('k')")), { ts: 123, value: 'x' });
assert.equal(call("storedFetchedAt('k')"), 123);
store.set('broken1', '{');
store.set('broken2', 'null');
store.set('broken3', '123');
store.set('broken4', JSON.stringify({ value: 'x' }));                 // ts が無い
store.set('broken5', JSON.stringify({ ts: 'abc', value: 'x' }));      // ts が壊れている
for (const k of ['broken1', 'broken2', 'broken3', 'broken4', 'broken5']) {
  assert.equal(call(`readStoredJson('${k}')`), null, `${k} は壊れた保存として null`);
  assert.equal(call(`storedFetchedAt('${k}')`), null);
}
assert.equal(call("removeStored('k')"), undefined);
assert.equal(call("readStoredJson('k')"), null);
// 書き込みが失敗しても落ちない
context.localStorage.setItem = () => { throw new Error('quota'); };
assert.equal(call("writeStoredJson('k2', { ts: 1 })"), false);

// =============================================
// hoshuStatusText（自動確定の状態の文言）
// =============================================
assert.equal(call('hoshuStatusText(null)'), '');
assert.equal(call('hoshuStatusText({ groups: [] })'), '');
assert.equal(
  call('hoshuStatusText({ startDate: "2026-09-08", groups: [{date:"2026-10-01",uchi:"代1",status:"changed"},{date:"2026-10-02",uchi:"代2",status:"pending"},{date:"2026-10-03",uchi:"代3",status:"pending"},{date:"2026-10-04",uchi:"代4",status:"confirmed"}] })'),
  '自動確定: 2026-09-08以降／翌日0:30頃。 再確定が必要: 2026-10-01 代1 未確定 2件。');
assert.equal(
  call('hoshuStatusText({ startDate: "2026-09-08", groups: [] })'),
  '自動確定: 2026-09-08以降／翌日0:30頃。 未確定 0件。');

// =============================================
// 画面の作り（要素とつなぎ込み）
// =============================================
assert.ok(html.includes('id="header-updated"'), 'ヘッダーに最終更新の欄がある');
assert.ok(html.includes('id="stock-reload-btn"') && html.includes('onclick="stockReload()"'), '貯玉タブに更新ボタンがある');
assert.ok(/Promise\.all\(\[\s*stockApi\(GAS_URL \+ '\?action=stockBalances'\),\s*stockApi\(GAS_URL \+ '\?action=stockLedger'\),/.test(script), '残高と台帳は同時に送る');
// 起動時は報酬の確定状態を取らない（タブを開いたときに取る）
const loadInitBody = script.match(/async function loadInit\(force\) \{[\s\S]*?\n\}/)[0];
assert.ok(!loadInitBody.includes('refreshHoshuStatus'), 'loadInit では報酬の確定状態を取らない');
assert.ok(script.includes("if (tab === 'hoshu') {") && /refreshHoshuStatus\(\)/.test(script), '報酬・設定タブを開いたときに取る');
// 取り直しの判定を4か所で使う
assert.equal((script.match(/shouldRefresh\(/g) || []).length, 5, 'shouldRefresh は定義1＋利用4');
// GASへ送る action 名は変えない
for (const action of ['init', 'records', 'getAutoEvents', 'getManualEvents', 'getEventNotes', 'hoshuStatus', 'stockBalances', 'stockLedger']) {
  assert.ok(script.includes('action=' + action), `${action} は今までどおり`);
}

// =============================================
// 起動時の分岐（今日の保存があれば取り直さない）
// =============================================
(async () => {
  const elemById = id => context.document.getElementById(id);
  const data = { shops: [], kishus: [], uchis: [], records: [{ date: '2026-10-15', kosshi: 1 }] };
  context.__fetches = 0;
  context.__duringHeader = '';
  call(`
    gasFetch = async () => {
      __fetches++;
      __duringHeader = document.getElementById('header-sub').textContent;
      return { ok: true, json: async () => ({ success: true, records: [], shops: [], kishus: [], uchis: [] }) };
    };
    currentTab = 'home';
  `);

  // 今日の保存があるとき：取り直さない
  store.set('pachinkob_cache_v1', JSON.stringify({ ts: Date.now(), data }));
  elemById('header-sub').textContent = '';
  await call('loadInit()');
  assert.equal(context.__fetches, 0, '今日の保存があれば取り直さない');
  assert.equal(elemById('header-sub').textContent, '全1件');
  assert.ok(elemById('header-updated').textContent.startsWith('最終更新 '), '最終更新を出す');
  assert.ok(!elemById('header-sub').textContent.includes('更新中'), '取り直していないので（更新中...）は出さない');

  // 日付が変わった保存のとき：取り直す（取り直している間だけ（更新中...））
  store.set('pachinkob_cache_v1', JSON.stringify({ ts: Date.now() - 36 * 3600 * 1000, data }));
  elemById('header-sub').textContent = '';
  await call('loadInit()');
  assert.equal(context.__fetches, 1, '日付が変わっていれば取り直す');
  assert.ok(context.__duringHeader.includes('（更新中...）'), '取り直している間は（更新中...）を出す');
  assert.ok(!elemById('header-sub').textContent.includes('更新中'), '終わったら消える');
  assert.equal(elemById('header-sub').textContent, '全0件');

  // 更新ボタン（force）は今日の保存があっても取り直す
  store.set('pachinkob_cache_v1', JSON.stringify({ ts: Date.now(), data }));
  await call('loadInit(true)');
  assert.equal(context.__fetches, 2, '更新ボタンは必ず取り直す');

  // 保存が壊れていたら取り直す
  store.set('pachinkob_cache_v1', '壊れた保存');
  await call('loadInit()');
  assert.equal(context.__fetches, 3, '保存が壊れていたら取り直す');

  console.log('PASS: 取り直しの判定、保存の読み書き、ヘッダーの最終更新、起動時の分岐、貯玉の同時取得');
})();
