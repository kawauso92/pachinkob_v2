// イベント画面（index.html）の表示判定のテスト。
// 既存の tests/stock_ui.test.cjs と同じ方式で script 全体を vm に読み込む。
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

// --- HTML上のUI要素 ---
assert.ok(html.includes('id="event-mode-row"'), 'パチンコ/スロット切り替えの行がある');
assert.ok(html.includes('id="event-warning"'), '収集状態の警告要素がある');
assert.ok(html.includes('>パチンコ<') && html.includes('>スロット<'), '切り替えボタンの文言');

// --- guessEventTarget（未登録の取材名の対象を推定） ---
context.at = null;
for (const [name, media, note, expected] of [
  ['エイムスター玉', '', '', 'P'],
  ['新台(PS)取材', '', '', 'PS'],
  ['スロパチステーション来店取材(黒)', 'スロパチステーション', '', 'P'],
  ['スロパチステーション来店取材(青)', 'スロパチステーション', '', 'PS'],
  ['普通の取材', '', '', 'S'],
]) {
  context.at = [name, media, note];
  assert.equal(call('guessEventTarget(at[0], at[1], at[2])'), expected, name);
}

// --- shortenEventPledge（公約の省略） ---
assert.equal(call("shortenEventPledge('短い公約', 60)"), '短い公約');
assert.equal(call("shortenEventPledge('', 60)"), '');
assert.equal(call("shortenEventPledge(null, 60)"), '');
context.longText = 'あ'.repeat(100);
assert.equal(call('shortenEventPledge(longText, 60)'), 'あ'.repeat(60) + '…');

// --- hasEventStatusWarning ---
assert.equal(call('hasEventStatusWarning(null)'), false);
context.st = [{ source: 'x', warning: true }];
assert.equal(call('hasEventStatusWarning(st)'), true);
context.st = [{ source: 'x' }];
assert.equal(call('hasEventStatusWarning(st)'), false);
context.st = { warning: true };
assert.equal(call('hasEventStatusWarning(st)'), true);

// --- isEventInfoKind ---
assert.equal(call("isEventInfoKind('旧イベント日')"), true);
assert.equal(call("isEventInfoKind('キャラ誕')"), true);
assert.equal(call("isEventInfoKind('取材')"), false);

// --- selectVisibleAutoEvents（対象・採用によるふるい分け） ---
context.events = [
  { date: '2026-10-10', store: 'A店', event: '拳懸かる取材', media: 'でちゃう！', kind: '取材' },
  { date: '2026-10-10', store: 'B店', event: 'スロパチステーション来店取材(黒)', media: 'スロパチステーション', kind: '取材' },
  { date: '2026-10-10', store: 'C店', event: 'はにてん来店', media: 'スロシックス', kind: '取材' },
  { date: '2026-10-10', store: 'D店', event: 'エイムスター玉', media: 'エイムスター', kind: '取材' },
  { date: '2026-10-10', store: 'E店', event: '未知の取材', media: '謎媒体', kind: '取材' },
  { date: '2026-10-10', store: 'F店', event: '旧イベント日', media: '', kind: '旧イベント日' },
];
context.judgements = [
  { event: '拳懸かる取材', media: 'でちゃう！', target: 'S', adopt: '採用', pledge: '拳の公約' },
  { event: 'スロパチステーション来店取材(黒)', media: 'スロパチステーション', target: 'PS', adopt: '採用' },
  { event: 'はにてん来店', media: 'スロシックス', target: 'S', adopt: '除外' },
  { event: 'エイムスター玉', media: 'エイムスター', target: 'P', adopt: '採用' },
];

context.mode = 'slot';
const slot = plain(call('selectVisibleAutoEvents(events, judgements, mode)'));
assert.deepEqual(slot.map(e => e.event), ['拳懸かる取材', 'スロパチステーション来店取材(黒)', '未知の取材'], 'スロット: 対象S/PS＋未判定を末尾');
assert.equal(slot[0].pledge, '拳の公約', '判定の公約が付く');
assert.equal(slot[2].unjudged, true, '判定表に無い取材名は未判定');
assert.equal(slot[2].target, 'S', '未判定は自動判定の対象');
assert.ok(!slot.some(e => e.event === 'はにてん来店'), '採用=除外は出さない');
assert.ok(!slot.some(e => e.event === '旧イベント日'), '店の情報は取材一覧に出さない');
assert.ok(!slot.some(e => e.event === 'エイムスター玉'), '対象Pはスロットに出さない');

context.mode = 'pachinko';
const pachinko = plain(call('selectVisibleAutoEvents(events, judgements, mode)'));
assert.deepEqual(pachinko.map(e => e.event), ['スロパチステーション来店取材(黒)', 'エイムスター玉'], 'パチンコ: 対象P/PSのみ');

// --- 媒体が空でも同名が1件なら一致（フォールバック） ---
context.j2 = [{ event: '独自取材', media: '', target: 'P', adopt: '採用' }];
context.e2 = [{ date: '2026-10-10', store: 'Z店', event: '独自取材', media: '謎媒体', kind: '取材' }];
context.mode = 'pachinko';
const fallback = plain(call('selectVisibleAutoEvents(e2, j2, mode)'));
assert.equal(fallback.length, 1);
assert.equal(fallback[0].target, 'P');

// --- computeVisibleEvents: 判定が無いときは全件表示（切り替えしない） ---
context.auto = [
  { date: '2026-10-10', store: 'A', event: '取材X', kind: '取材' },
  { date: '2026-10-11', store: 'B', event: '旧イベント日', kind: '旧イベント日' },
];
context.manual = [{ date: '2026-10-09', store: 'C', event: '手動', source: 'manual' }];
const legacy = plain(call("computeVisibleEvents(auto, manual, [], 'pachinko', false)"));
assert.deepEqual(legacy.map(e => e.event), ['手動', '取材X', '旧イベント日'], '判定なしは全件（店の情報も含む）');
const judged = plain(call("computeVisibleEvents(e2, [], j2, 'slot', true)"));
assert.equal(judged.length, 0, '判定ありのときは対象Pをスロットで非表示');

// --- renderEventItem: 未判定タグと公約の表示/非表示 ---
context.item = { date: '2026-10-10', store: 'A店', event: '取材X', area: '大阪', source: 'auto', pledge: '公約テキスト', unjudged: true };
const itemHtml = call('renderEventItem(item)');
assert.ok(itemHtml.includes('推測される公約'), '公約を表示');
assert.ok(itemHtml.includes('未判定'), '未判定タグを表示');
assert.ok(itemHtml.includes('data-full="公約テキスト"'), '全文を保持');
context.item = { date: '2026-10-10', store: 'A店', event: '取材Y', area: '大阪', source: 'auto', pledge: '', unjudged: false };
assert.ok(!call('renderEventItem(item)').includes('推測される公約'), '公約が空なら出さない');

console.log('PASS: イベント画面のP/S切り替え・採否・公約・店の情報・警告');
