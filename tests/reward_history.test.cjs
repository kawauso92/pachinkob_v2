// 報酬履歴（報酬・設定タブの上半分）のまとめ方・合計のテスト。
// 既存の tests/event_view.test.cjs と同じ方式で script 全体を vm に読み込む。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({
  window: { addEventListener() {} },
  document: { addEventListener() {}, getElementById() { return {}; }, querySelectorAll() { return []; } },
  console,
  setTimeout() {},
});
vm.runInContext(script, context);
const call = expression => vm.runInContext(expression, context);
const plain = value => JSON.parse(JSON.stringify(value));

// --- HTML上のUI（報酬・設定タブの上半分／下半分） ---
const hoshuBlock = html.slice(html.indexOf('id="tab-hoshu"'), html.indexOf('<div class="bottom-nav"'));
for (const id of ['reward-history-list', 'rh-filter-month', 'rh-filter-uchi', 'auto-hoshu-status', 'hoshu-confirm-btn', 'set-shop']) {
  assert.ok(hoshuBlock.includes(`id="${id}"`), `${id} が報酬・設定タブの中にある`);
}
assert.ok(hoshuBlock.indexOf('reward-history-list') < hoshuBlock.indexOf('auto-hoshu-status'), '報酬履歴が上半分');
assert.ok(hoshuBlock.indexOf('auto-hoshu-status') < hoshuBlock.indexOf('hoshu-confirm-btn'), '自動確定の状態の下に再確定');
assert.ok(hoshuBlock.indexOf('hoshu-confirm-btn') < hoshuBlock.indexOf('id="set-shop"'), 'マスタ編集は下半分');
assert.ok(hoshuBlock.includes('<details class="set-details">') && hoshuBlock.includes('</details>'), 'マスタ編集はdetailsで閉じる');
assert.ok(hoshuBlock.includes('<summary>マスタ編集'), 'マスタ編集の見出し');
assert.ok(!hoshuBlock.includes('<details class="set-details" open'), 'マスタ編集は初期は閉じる');
const htmlBody = html.slice(html.indexOf('<body>'), html.indexOf('<script>'));
assert.ok(!htmlBody.includes('hoshu-result-panel'), '手動確定の一覧（hoshu-result-panel）は出さない');
assert.ok(!htmlBody.includes('REWARD SUMMARY'), 'REWARD SUMMARYは出さない');
assert.ok(script.includes('function renderHoshuTab('), '報酬・設定タブの描画関数がある');

// --- まとめる元の記録 ---
context.recs = [
  // 同日・同打ち手の3行。金額は最後の行だけに入り、他は0
  { date: '2026-10-10', uchi: '代1', hoshu: 0,    koujo: 0,    sagitama: 2000, genkinInvest: 0,     row: 11 },
  { date: '2026-10-10', uchi: '代1', hoshu: 0,    koujo: 0,    sagitama: 3000, genkinInvest: 0,     row: 12 },
  { date: '2026-10-10', uchi: '代1', hoshu: 5000, koujo: 1200, sagitama: 0,    genkinInvest: 10000, row: 13 },
  // 報酬0のまとまり（スタート未達）
  { date: '2026-10-09', uchi: '代2', hoshu: 0,    koujo: 0,    sagitama: 1000, genkinInvest: 5000,  row: 14 },
  // 自分の記録は報酬対象外
  { date: '2026-10-10', uchi: '自分', hoshu: 9999, koujo: 0,   sagitama: 1,    genkinInvest: 0,     row: 15 },
  // 打ち手の記入が無い行は自分として除く
  { date: '2026-10-08',              hoshu: 9999, koujo: 0,    sagitama: 1,    genkinInvest: 0,     row: 16 },
  // 別の月
  { date: '2026-09-20', uchi: '代1', hoshu: 2500, koujo: 300,  sagitama: 2500, genkinInvest: 2000,  row: 17 },
];

// --- buildRewardHistory（日付×打ち手でまとめる・新しい日付順） ---
const groups = plain(call('buildRewardHistory(recs)'));
assert.equal(groups.length, 3, '自分と日付なしは除く');
assert.deepEqual(groups.map(g => [g.date, g.uchi]),
  [['2026-10-10', '代1'], ['2026-10-09', '代2'], ['2026-09-20', '代1']], '新しい日付順');
assert.deepEqual(groups[0], {
  date: '2026-10-10', uchi: '代1', month: '2026-10',
  hoshu: 5000, koujo: 1200, sagitama: 5000, genkinInvest: 10000, count: 3,
}, '最後の行にだけ金額が入るケース');
assert.deepEqual(groups[1], {
  date: '2026-10-09', uchi: '代2', month: '2026-10',
  hoshu: 0, koujo: 0, sagitama: 1000, genkinInvest: 5000, count: 1,
}, '全部0のケース（未達）');
assert.deepEqual(call('buildRewardHistory(recs).some(g => g.uchi === "自分")'), false, '自分の記録は除く');
assert.equal(call('buildRewardHistory([{date:"2026-10-01", uchi:"自分", hoshu:5000}]).length'), 0, '自分のみなら空');
assert.deepEqual(plain(call('buildRewardHistory(null)')), []);
assert.deepEqual(plain(call('buildRewardHistory([{uchi:"代1", hoshu:100}])')), [], '日付なしはまとめない');

// --- filterRewardHistory（月・打ち手） ---
assert.equal(call('filterRewardHistory(buildRewardHistory(recs), {month:"all",uchi:"all"}).length'), 3);
assert.equal(call('filterRewardHistory(buildRewardHistory(recs), {month:"2026-10"}).length'), 2);
assert.equal(call('filterRewardHistory(buildRewardHistory(recs), {uchi:"代2"}).length'), 1);
assert.equal(call('filterRewardHistory(buildRewardHistory(recs), {month:"2026-10",uchi:"代2"}).length'), 1);
assert.equal(call('filterRewardHistory(buildRewardHistory(recs), {month:"2026-06"}).length'), 0);

// --- summarizeRewardHistory（月ごとの小計と打ち手別合計） ---
const summary = plain(call('summarizeRewardHistory(buildRewardHistory(recs))'));
assert.deepEqual(summary.byMonth, {
  '2026-10': { hoshu: 5000, koujo: 1200, count: 2 },
  '2026-09': { hoshu: 2500, koujo: 300, count: 1 },
});
assert.deepEqual(summary.byUchi, {
  '代1': { hoshu: 7500, koujo: 1500, sagitama: 7500, genkinInvest: 12000, count: 4 },
  '代2': { hoshu: 0, koujo: 0, sagitama: 1000, genkinInvest: 5000, count: 1 },
});
assert.deepEqual(summary.total, { hoshu: 7500, koujo: 1500 });
// 表示中（＝絞り込み後）の合計になる
assert.deepEqual(plain(call('summarizeRewardHistory(filterRewardHistory(buildRewardHistory(recs), {month:"2026-09"})).total')),
  { hoshu: 2500, koujo: 300 });
assert.deepEqual(plain(call('summarizeRewardHistory([])')), { byMonth: {}, byUchi: {}, total: { hoshu: 0, koujo: 0 } });

// --- 絞り込みの選択肢と保存値の正規化 ---
const opt = plain(call('buildRewardHistoryFilterOptions(buildRewardHistory(recs))'));
assert.deepEqual(opt.months, ['2026-10', '2026-09']);
assert.deepEqual(opt.uchis, ['代1', '代2'], '自分は選択肢に出ない');
assert.deepEqual(plain(call('normalizeRewardHistoryFilter({month:"2026-08",uchi:"代9"}, buildRewardHistoryFilterOptions(buildRewardHistory(recs)))')),
  { month: 'all', uchi: 'all' });
assert.deepEqual(plain(call('normalizeRewardHistoryFilter({month:"2026-10",uchi:"代2"}, buildRewardHistoryFilterOptions(buildRewardHistory(recs)))')),
  { month: '2026-10', uchi: '代2' });

// --- 報酬0の表示 ---
assert.equal(call('rewardHistoryYen(0)'), '0円（未達）');
assert.equal(call('rewardHistoryYen(5000)'), '¥5,000');

// --- groupRewardHistoryByUchi（打ち手ごとの折りたたみ用のまとめ） ---
const folded = plain(call('groupRewardHistoryByUchi(buildRewardHistory(recs))'));
assert.deepEqual(folded.map(d => d.uchi), ['代1', '代2'], '打ち手ごとに分ける');
assert.deepEqual(folded[0], {
  uchi: '代1', hoshu: 7500, koujo: 1500, sagitama: 7500, genkinInvest: 12000, days: 2,
  groups: [
    { date: '2026-10-10', uchi: '代1', month: '2026-10', hoshu: 5000, koujo: 1200, sagitama: 5000, genkinInvest: 10000, count: 3 },
    { date: '2026-09-20', uchi: '代1', month: '2026-09', hoshu: 2500, koujo: 300, sagitama: 2500, genkinInvest: 2000, count: 1 },
  ],
}, '日数と合計、その人の日付だけを中に入れる');
assert.equal(folded[1].days, 1);
assert.equal(folded[1].hoshu, 0, '未達の打ち手も1人として出す');
assert.deepEqual(plain(call('groupRewardHistoryByUchi([])')), []);
assert.deepEqual(plain(call('groupRewardHistoryByUchi(null)')), []);
// 絞り込むと、その打ち手だけ・その期間だけになる
const foldedOne = plain(call('groupRewardHistoryByUchi(filterRewardHistory(buildRewardHistory(recs), {month:"2026-09"}))'));
assert.deepEqual(foldedOne.map(d => [d.uchi, d.days, d.hoshu]), [['代1', 1, 2500]]);

// --- 報酬履歴の折りたたみ（見出しに打ち手名と合計、中に日付の一覧） ---
// 要素を覚えるdocumentに差し替えてから描く
const elements = new Map();
context.document.getElementById = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '' });
  return elements.get(id);
};
call('ALL_RECORDS = recs; rewardHistoryFilter = { month: "all", uchi: "all" };');
call('renderRewardHistory()');
const htmlOut = elements.get('reward-history-list').innerHTML;
assert.ok(htmlOut.includes('<details class="rh-uchi-details">'), '打ち手ごとのdetails');
assert.ok(!/<details[^>]* open/.test(htmlOut), '初期は閉じている');
assert.ok(htmlOut.includes('>代1</span>') && htmlOut.includes('>代2</span>'), '見出しに打ち手名');
assert.ok(htmlOut.includes('報酬 ¥7,500') && htmlOut.includes('控除 ¥1,500') && htmlOut.includes('2日'), '見出しに表示中の期間の合計と日数');
assert.ok(htmlOut.includes('2026年10月 小計'), '中に月の小計');
assert.ok(htmlOut.includes('0円（未達）'), '未達も出す');
assert.ok(htmlOut.includes('合計（2人）'), '表示中の合計');

// --- 絞り込みの選択はlocalStorageに保存する（読み書きはtry/catch） ---
assert.ok(/try \{ localStorage\.setItem\(REWARD_HISTORY_FILTER_KEY/.test(script), 'localStorage書き込みはtry/catch');
assert.ok(/try \{\n?\s*const raw = localStorage\.getItem\(REWARD_HISTORY_FILTER_KEY\)/.test(script), 'localStorage読み取りはtry/catch');

console.log('PASS: 報酬履歴の日付×打ち手のまとめ、月小計・打ち手別合計、未達表示、自分の除外');
