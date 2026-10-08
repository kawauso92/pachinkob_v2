// イベント解析関数（gas/EventParsers.gs）の純関数テスト。
// 既存の tests/stock_ledger.test.cjs と同じ vm 方式で読み込む。
// 模擬HTMLは手書き（実サイトのHTMLは保存・コミットしない）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../gas/EventParsers.gs'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);

// 戻り値をプレーンな値へ変換して比較する
function run(expression) {
  return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

const REF = '2026-10-08T00:00:00Z';
context.ref = REF;

let passed = 0;
const failures = [];
function check(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    passed += 1;
  } catch (err) {
    failures.push(`${label}\n  実際: ${JSON.stringify(actual)}\n  期待: ${JSON.stringify(expected)}`);
  }
}

// =============================================
// resolveYear / parseJpDate / parseSlashDate
// =============================================
check('resolveYear 通常', run("resolveYear(12, 31, ref)"), '2026-12-31');
check('resolveYear 年またぎ(基準10月→1月は翌年)', run("resolveYear(1, 5, ref)"), '2027-01-05');
check('resolveYear 基準1月の1月5日は当年', run("resolveYear(1, 5, '2026-01-10T00:00:00Z')"), '2026-01-05');
check('resolveYear 基準1月の12月は前年', run("resolveYear(12, 31, '2026-01-10T00:00:00Z')"), '2025-12-31');
check('parseJpDate 曜日つき', run("parseJpDate('10月11日(日) 取材', ref)"), '2026-10-11');
check('parseJpDate 曜日なし', run("parseJpDate('10月11日', ref)"), '2026-10-11');
check('parseJpDate 不一致はnull', run("parseJpDate('ABC', ref)"), null);
check('parseSlashDate', run("parseSlashDate('2026/10/08')"), '2026-10-08');
check('parseSlashDate 不一致はnull', run("parseSlashDate('10月8日')"), null);

// =============================================
// eventKey（正規化）
// =============================================
context.rec = { date: ' 2026-10-08 ', store: '店　A', event: '取材（黒）' };
check('eventKey 前後空白除去・全角空白を1つに', run('eventKey(rec)'), '2026-10-08|店 A|取材（黒）');
check('eventKey null', run('eventKey(null)'), '');

// =============================================
// HTML→テキスト / 実体参照
// =============================================
check('タグ除去', run("evHtmlToText('<b>A</b>と<i>B</i>')"), 'AとB');
check('実体参照 &amp;', run("evHtmlToText('A&amp;B')"), 'A&B');
check('実体参照 &amp;lt; は &lt; に', run("evHtmlToText('&amp;lt;')"), '&lt;');
check('数値実体参照', run("evHtmlToText('&#65;&#x42;')"), 'AB');
check('htmlToLines は空行を除く', run("htmlToLines('<div>A</div><div></div><div>B</div>')"), ['A', 'B']);
check('htmlToLines はscriptを除外', run("htmlToLines('<div>A</div><script>var x=1;</script><div>B</div>')"), ['A', 'B']);

// =============================================
// autoTarget（計画書「自動判定」）
// =============================================
context.at = null;
const autoCases = [
  ['エイムスター玉', '', '', 'P'],
  ['エイムスター超玉', '', '', 'P'],
  ['新台(PS)取材', '', '', 'PS'],
  ['スロパチステーション来店取材(黒)', 'スロパチステーション', '', 'P'],
  ['スロパチステーション来店取材(青)', 'スロパチステーション', '', 'PS'],
  ['スロパチステーション来店取材(青)', 'スロパチステーション', 'パチスロの複数機種が並びで対象？', 'PS'],
  ['なんとか取材', '媒体', '⇒パチンコ', 'P'],
  ['なんとか取材', '媒体', '⇒パチンコ・パチスロ', 'PS'],
  ['わーさん玉道場', '', '', 'P'],
  ['じゃんばり潜入来店取材', '', '', 'S'],
  ['普通の取材', '', '', 'S'],
];
for (const [name, media, note, expected] of autoCases) {
  context.at = [name, media, note];
  check(`autoTarget(${name}, ${media}, ${note})`, run('autoTarget(at[0], at[1], at[2])'), expected);
}

// =============================================
// パチスロ100
// =============================================
context.p100 = `
<div class="event-section">
  <div class="event-header"> <strong>2026/10/08</strong>
    <div class="event-badges"> <span class="badge badge-region">堺市西区</span> <span class="badge badge-survey">取材</span> </div>
  </div>
  <div class="store-name"><strong>K&rsquo;ZONE鳳</strong></div>
  <div class="event-info">・拳懸かる取材（でちゃう！）</div>
  <div class="event-info">・水懸かる取材（でちゃう！）</div>
  <div class="event-info">　⇒<a href="x">パチスロの複数機種が並びで対象？</a></div>
  <hr>
  <div style="font-size:0.85rem;color:#666;"> 【当日の入場情報】<br> 開店時間：10時<br> 抽選方法：シャッフル抽選</div>
</div>
<div class="event-section">
  <div class="event-header"> <strong>2026/10/08</strong>
    <div class="event-badges"> <span class="badge badge-region">河内長野市</span> <span class="badge badge-old-event">旧イベント日</span> </div>
  </div>
  <div class="store-name"><strong>HYPER ARROW松ヶ丘店</strong></div>
  <div class="event-info">・旧イベント日（8のつく日）</div>
</div>
<div class="event-section">
  <div class="event-header"> <strong>2026/10/10</strong>
    <div class="event-badges"><span class="badge badge-anniversary">周年日</span></div>
  </div>
  <div class="store-name">・深井アロー</div>
  <div class="event-info"><a href="x">大阪府の周年日一覧はこちら</a></div>
</div>
<div class="event-section">
  <div class="event-header"><strong>2026/10/08</strong>
    <div class="event-badges"><span class="badge badge-character-birthday">キャラ誕</span></div>
  </div>
  <div class="store-name">・神代 利世（東京喰種）</div>
  <div class="store-name">・叢（閃乱カグラ）</div>
</div>
<div class="event-section">
  <div class="event-header"> <strong>2026/10/08</strong>
    <div class="event-badges"> <span class="badge badge-region">堺市西区</span> <span class="badge badge-survey">取材</span> <span class="badge badge-old-event">旧イベント日</span> </div>
  </div>
  <div class="store-name"><strong>VERDE堺店</strong></div>
  <div class="event-info">・旧イベント日（8のつく日）</div>
  <div class="event-info">・水懸かる取材（でちゃう！）</div>
</div>
`;
const p100 = run('parsePachisuro100(p100, ref)');
check('パチスロ100 件数', p100.length, 8);
check('パチスロ100 1件目', p100[0], {
  date: '2026-10-08', store: 'K’ZONE鳳', area: '堺市西区', kind: '取材',
  event: '拳懸かる取材', media: 'でちゃう！', note: '',
  source: 'パチスロ100', source_url: 'https://pachisuro100.com/osaka-schedule/',
});
check('パチスロ100 ⇒補足が直前の取材に付く', p100[1].note, 'パチスロの複数機種が並びで対象？');
check('パチスロ100 【当日の入場情報】以降は捨てる', p100[1].event, '水懸かる取材');
check('パチスロ100 旧イベント日', p100[2], {
  date: '2026-10-08', store: 'HYPER ARROW松ヶ丘店', area: '河内長野市', kind: '旧イベント日',
  event: '旧イベント日', media: '', note: '8のつく日',
  source: 'パチスロ100', source_url: 'https://pachisuro100.com/osaka-schedule/',
});
check('パチスロ100 周年日は店の情報', p100[3].kind, '周年日');
check('パチスロ100 周年日の店名', p100[3].store, '深井アロー');
check('パチスロ100 キャラ誕は店名ごとに1件', [p100[4].kind, p100[5].kind], ['キャラ誕', 'キャラ誕']);
check('パチスロ100 キャラ誕の店名', [p100[4].store, p100[5].store], ['神代 利世（東京喰種）', '叢（閃乱カグラ）']);
check('パチスロ100 取材+旧イベント日の両方', [p100[6].kind, p100[6].event, p100[7].kind, p100[7].event], ['旧イベント日', '旧イベント日', '取材', '水懸かる取材']);
check('パチスロ100 壊れたHTMLは空配列', run("parsePachisuro100('<div class=><<>>', ref)"), []);
check('パチスロ100 空文字は空配列', run("parsePachisuro100('', ref)"), []);

// =============================================
// エイムスター
// =============================================
context.aims = `
<a class="c-schedule__item" href="#">
  <span class="c-schedule__date">12月31日(水)</span>
  <span class="c-schedule__area">大阪</span>
  <span class="c-schedule__title">マルハン加島店</span>
</a>
<a class="c-schedule__item" href="#">
  <span class="c-schedule__date">1月5日(月)</span>
  <span class="c-schedule__area">大阪</span>
  <span class="c-schedule__title">店B</span>
</a>
<a class="c-schedule__item" href="#">
  <span class="c-schedule__area">大阪</span>
  <span class="c-schedule__title">日付なし店</span>
</a>
<a class="c-schedule__item" href="#">
  <span class="c-schedule__date">12月20日(土)</span>
  <span class="c-schedule__area">兵庫</span>
  <span class="c-schedule__title">店C</span>
</a>
`;
const aims = run("parseAims(aims, 'https://aims777.com/syuzai/aimstar_gyoku/', 'エイムスター玉', ref)");
check('エイムスター 大阪のみ・年またぎ', aims, [
  { date: '2026-12-31', store: 'マルハン加島店', area: '大阪', kind: '取材', event: 'エイムスター玉', media: '', note: '', source: 'エイムスター', source_url: 'https://aims777.com/syuzai/aimstar_gyoku/' },
  { date: '2027-01-05', store: '店B', area: '大阪', kind: '取材', event: 'エイムスター玉', media: '', note: '', source: 'エイムスター', source_url: 'https://aims777.com/syuzai/aimstar_gyoku/' },
]);
check('エイムスター 壊れたHTMLは空配列', run("parseAims('<<<', 'u', 'e', ref)"), []);

// =============================================
// ジャンバリ（日付/都道府県/店名/取材名の4行組）
// =============================================
context.janbari = `
<div>10月11日(日)</div><div>滋賀</div><div>マルハン草津店</div><div>じゃんばり潜入来店取材</div>
<div>10月12日(月)</div><div>大阪</div><div>店D</div><div>じゃんばり潜入来店取材</div>
`;
check('ジャンバリ 大阪のみ', run('parseJanbari(janbari, ref)'), [
  { date: '2026-10-12', store: '店D', area: '大阪', kind: '取材', event: 'じゃんばり潜入来店取材', media: '', note: '', source: 'ジャンバリ', source_url: 'https://jb-portal.com/schedule/?report_id=5' },
]);
check('ジャンバリ 壊れたHTMLは空配列', run("parseJanbari('<div', ref)"), []);

// =============================================
// たま道場（日付 / 大阪 / 種別 / 店名。先頭の「・」は無視）
// =============================================
context.tamadojo = `
<div>10月8日</div><div>大阪</div><div>玉道場</div><div>店E</div>
<div>10月9日</div><div>・大阪</div><div>道場破り</div><div>店F</div>
<div>10月10日</div><div>滋賀</div><div>玉道場</div><div>店G</div>
`;
check('たま道場 大阪のみ・種別→取材名', run('parseTamaDojo(tamadojo, ref)'), [
  { date: '2026-10-08', store: '店E', area: '大阪', kind: '取材', event: 'わーさん玉道場', media: '', note: '', source: 'たま道場', source_url: 'https://tama-dojo.com/' },
  { date: '2026-10-09', store: '店F', area: '大阪', kind: '取材', event: 'わーさん道場破り', media: '', note: '', source: 'たま道場', source_url: 'https://tama-dojo.com/' },
]);
check('たま道場 壊れたHTMLは空配列', run("parseTamaDojo('<div', ref)"), []);

// =============================================
// 結果
// =============================================
if (failures.length) {
  console.error(`event_parsers: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('FAIL - ' + f + '\n');
  process.exit(1);
}
console.log(`event_parsers: ${passed} passed, 0 failed`);
