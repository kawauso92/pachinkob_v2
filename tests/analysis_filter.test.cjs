// 分析タブの絞り込み（月・機種・打ち手）と要約のテスト。
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

// --- HTML上のUI要素（下のタブ6つ・分析の絞り込み） ---
assert.equal((html.match(/class="nav-btn/g) || []).length, 6, '下のタブは6つ');
assert.ok(!html.includes('id="nav-master"'), 'マスタのタブは消えている');
assert.ok(!html.includes('id="tab-master"'), 'マスタのタブ内容は消えている（報酬・設定へ移動）');
for (const [id, label] of [['nav-home','ホーム'],['nav-analysis','分析'],['nav-records','記録'],['nav-stock','貯玉'],['nav-events','イベント'],['nav-hoshu','報酬・設定']]) {
  assert.ok(html.includes(`id="${id}"`), `${id} がある`);
  assert.ok(html.includes(`<div>${label}</div>`), `ラベル「${label}」がある`);
}
for (const id of ['an-filter-month', 'an-filter-kishu', 'an-filter-uchi', 'an-filter-summary']) {
  assert.ok(html.includes(`id="${id}"`), `${id} がある`);
}
assert.ok(!html.includes("setRankPeriod("), '総合タブの期間ボタンは月の絞り込みに統合して消してある');
assert.ok(html.includes("if (tab === 'master') tab = 'hoshu';"), "switchTab('master') は報酬・設定へ向く");

// --- 絞り込み・要約に使う記録 ---
context.recs = [
  { date: '2026-10-01', kishu: '機種A', uchi: '自分', kosshi: 1000,  shigoto: 500, jikan: '2:00', kitaiJikyu: 2000 },
  { date: '2026-09-01', kishu: '機種B', uchi: '代1',  kosshi: -500,  shigoto: 300, jikan: '1:00', kitaiJikyu: 1800 },
  { date: '2026-10-05', kishu: '機種A', uchi: '代1',  kosshi: 200,   shigoto: 100, jikan: '1:30', kitaiJikyu: 2200 },
  { date: '2026-07-01', kishu: '機種C', uchi: '自分', kosshi: 0,     shigoto: 0,   jikan: '0:30', kitaiJikyu: 1500 },
];

// --- buildAnalysisFilterOptions（記録にあるものだけ・月は新しい順） ---
const options = plain(call('buildAnalysisFilterOptions(recs)'));
assert.deepEqual(options.months, ['2026-10', '2026-09', '2026-07'], '月は記録にある月だけを新しい順に');
assert.deepEqual([...options.kishus].sort(), ['機種A', '機種B', '機種C']);
assert.deepEqual([...options.uchis].sort(), ['代1', '自分']);
assert.deepEqual(plain(call('buildAnalysisFilterOptions([])')), { months: [], kishus: [], uchis: [] });

// --- normalizeAnalysisFilter（選択肢に無い保存値は all に戻す） ---
assert.deepEqual(plain(call('normalizeAnalysisFilter({month:"2026-08",kishu:"機種X",uchi:"代9"}, buildAnalysisFilterOptions(recs))')),
  { month: 'all', kishu: 'all', uchi: 'all' });
assert.deepEqual(plain(call('normalizeAnalysisFilter({month:"2026-10",kishu:"機種A",uchi:"代1"}, buildAnalysisFilterOptions(recs))')),
  { month: '2026-10', kishu: '機種A', uchi: '代1' });
assert.deepEqual(plain(call('normalizeAnalysisFilter({month:"3m"}, buildAnalysisFilterOptions(recs))')),
  { month: '3m', kishu: 'all', uchi: 'all' }, '直近3か月はそのまま残す');
assert.deepEqual(plain(call('normalizeAnalysisFilter(null, {})')), { month: 'all', kishu: 'all', uchi: 'all' });

// --- analysisMonthMatches（nowは確認用に渡せる） ---
const m = (date, month) => call(`analysisMonthMatches('${date}', '${month}', new Date('2026-10-15T00:00:00'))`);
assert.equal(m('2026-10-05', 'all'), true);
assert.equal(m('2026-10-05', '2026-10'), true);
assert.equal(m('2026-09-05', '2026-10'), false);
assert.equal(m('2026-10-05', '3m'), true, '当月は3か月に含む');
assert.equal(m('2026-08-05', '3m'), true, '2か月前は含む');
assert.equal(m('2026-07-05', '3m'), false, '3か月前は含まない');
assert.equal(m('2025-10-05', '3m'), false, '過去すぎは含まない');
assert.equal(call("analysisMonthMatches('', '3m', new Date('2026-10-15T00:00:00'))"), false);
assert.equal(call("analysisMonthMatches(null, '3m', new Date('2026-10-15T00:00:00'))"), false);

// --- filterAnalysisRecords（3つが同時に効く） ---
const now = "new Date('2026-10-15T00:00:00')";
assert.equal(call('filterAnalysisRecords(recs, {month:"all",kishu:"all",uchi:"all"}).length'), 4);
assert.equal(call('filterAnalysisRecords(recs, {month:"2026-10"}).length'), 2);
assert.equal(call('filterAnalysisRecords(recs, {kishu:"機種A"}).length'), 2);
assert.equal(call('filterAnalysisRecords(recs, {uchi:"代1"}).length'), 2);
assert.equal(call('filterAnalysisRecords(recs, {month:"2026-10",kishu:"機種A",uchi:"代1"}).length'), 1, '3つ同時');
assert.equal(call(`filterAnalysisRecords(recs, {month:"3m"}, ${now}).length`), 3, '直近3か月');
assert.equal(call('filterAnalysisRecords(recs, {month:"2026-06"}).length'), 0);
assert.equal(call('filterAnalysisRecords(null, {month:"all"}).length'), 0);
assert.deepEqual(plain(call('filterAnalysisRecords(recs, {month:"2026-10"}).map(r => r.date)')), ['2026-10-01', '2026-10-05']);

// --- summarizeAnalysisRecords（件数・収支・仕事量・稼働時間・時給・平均期待時給） ---
assert.deepEqual(plain(call('summarizeAnalysisRecords(recs)')), {
  count: 4, total: 700, shigoto: 900, jikanMin: 300, jikyu: 140, avgKitai: 1970,
});
// 試し打ちは件数と収支には数えるが、仕事量・稼働時間・期待時給からは除く（既存ルール）
context.trial = [{ date: '2026-10-02', kishu: '試し打ち', uchi: '自分', kosshi: 500, shigoto: 999, jikan: '5:00', kitaiJikyu: 3000 }];
assert.deepEqual(plain(call('summarizeAnalysisRecords(trial)')), {
  count: 1, total: 500, shigoto: 0, jikanMin: 0, jikyu: null, avgKitai: null,
});
assert.deepEqual(plain(call('summarizeAnalysisRecords(recs.concat(trial))')), {
  count: 5, total: 1200, shigoto: 900, jikanMin: 300, jikyu: 240, avgKitai: 1970,
});
// 記録が無いときは 0 と null
assert.deepEqual(plain(call('summarizeAnalysisRecords([])')), {
  count: 0, total: 0, shigoto: 0, jikanMin: 0, jikyu: null, avgKitai: null,
});

// --- 絞り込みの選択はlocalStorageに保存する（読み書きはtry/catch） ---
assert.ok(script.includes("localStorage.setItem(ANALYSIS_FILTER_KEY"), '分析の絞り込みを保存する');
assert.ok(/try \{ localStorage\.setItem\(ANALYSIS_FILTER_KEY/.test(script), 'localStorage書き込みはtry/catch');
assert.ok(/try \{\n?\s*const raw = localStorage\.getItem\(ANALYSIS_FILTER_KEY\)/.test(script), 'localStorage読み取りはtry/catch');

console.log('PASS: 分析の月・機種・打ち手の絞り込みと要約（試し打ちの除外ルール）');
