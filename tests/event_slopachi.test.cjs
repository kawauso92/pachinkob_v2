// スロパチの実サイトfixture（2026-10-30）で、色付きの読み取り・
// パチスロ100との重複まとめ・中継のエラー文言を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.join(__dirname, '../gas');
const source = fs.readFileSync(path.join(base, 'EventParsers.gs'), 'utf8') + '\n' +
  fs.readFileSync(path.join(base, 'EventCollector.gs'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
context.ref = '2026-10-30T00:00:00Z';
const run = expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/events-20261030/' + name), 'utf8');

// =============================================
// 1. 読み取り: 関西ページの大阪25件と、色付きの5件
// =============================================
context.slopachiHtml = fixture('slopachi_kansai.html');
context.p100Html = fixture('pachisuro100_osaka.html');
const slopachi = run('parseSlopachiJsonLd(slopachiHtml, "https://777.slopachi-station.com/report_schedule/kansai/")');
assert.equal(slopachi.length, 25);
const pick = (date, store) => slopachi.find(item => item.date === date && item.store === store);
assert.equal(pick('2026-11-01', 'HYPER ARROW 美原店').event, 'スロパチステーション来店取材(オレンジ)');
assert.equal(pick('2026-11-05', 'P.E.KING OF KINGS 1333 高槻').event, 'スロパチアワード景品入荷(赤)');
assert.equal(pick('2026-11-06', 'P.E.KING OF KINGS 1333 高槻').event, 'スロパチステーション来店取材(青)');
assert.equal(pick('2026-11-07', 'HYPER ARROW 美原店').event, 'スロパチステーション来店取材(紫)');
assert.equal(pick('2026-11-07', 'P.E.KING OF KINGS 1333 高槻').event, 'スロパチステーション来店取材(紫)');

// 4ページをまとめると、関西ページと演者ページの重複2件を除いて25件になる
context.slopachiRenjiro = fixture('slopachi_renjiro.html');
context.slopachiJanjan = fixture('slopachi_janjan.html');
context.slopachiRuibee = fixture('slopachi_ruibee.html');
context.allSlopachiRecords = slopachi
  .concat(run('parseSlopachiJsonLd(slopachiRenjiro, "u")'))
  .concat(run('parseSlopachiJsonLd(slopachiJanjan, "u")'))
  .concat(run('parseSlopachiJsonLd(slopachiRuibee, "u")'));
assert.equal(context.allSlopachiRecords.length, 27);
assert.equal(run('eventUniqueRecords(allSlopachiRecords)').length, 25);

// =============================================
// 2. パチスロ100との重複まとめ
// =============================================
context.p100Records = run('parsePachisuro100(p100Html, ref)');
context.slopachiRecords = slopachi;
const merged = run('eventMergeSlopachiDuplicates(p100Records.concat(slopachiRecords))');
assert.equal(context.p100Records.length, 763);
assert.equal(merged.length, 768); // 763 + 25 - 20
assert.equal(763 + 25 - merged.length, 20); // まとめた重複

const slopachiInMerged = merged.filter(item => item.source === 'スロパチ公式');
assert.equal(slopachiInMerged.length, 25);
const p100Slopachi = merged.filter(item => item.source === 'パチスロ100' && item.media === 'スロパチステーション');
assert.equal(p100Slopachi.length, 23); // 43 - 20

// パチスロ100に無かった5件が、色付きのスロパチ公式として残る
const has = (date, store, event) => merged.some(item =>
  item.date === date && item.store === store && item.event === event && item.source === 'スロパチ公式');
assert.ok(has('2026-11-01', 'HYPER ARROW 美原店', 'スロパチステーション来店取材(オレンジ)'));
assert.ok(has('2026-11-05', 'P.E.KING OF KINGS 1333 高槻', 'スロパチアワード景品入荷(赤)'));
assert.ok(has('2026-11-06', 'P.E.KING OF KINGS 1333 高槻', 'スロパチステーション来店取材(青)'));
assert.ok(has('2026-11-07', 'HYPER ARROW 美原店', 'スロパチステーション来店取材(紫)'));
assert.ok(has('2026-11-07', 'P.E.KING OF KINGS 1333 高槻', 'スロパチステーション来店取材(紫)'));

// 同じ日・同じ店に、パチスロ100とスロパチ公式が並ばない
const groups = new Map();
merged.forEach(item => {
  if (item.media !== 'スロパチステーション') return;
  const key = item.date + '|' + item.store;
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key).add(item.source);
});
groups.forEach((sources, key) => {
  assert.ok(!(sources.has('パチスロ100') && sources.has('スロパチ公式')), '重複が残っている: ' + key);
});

// MEGAFACE/MEGAフェイスの表記ゆれも重複として消える
assert.ok(!merged.some(item => item.source === 'パチスロ100' && item.date === '2026-10-31' &&
  item.media === 'スロパチステーション' && item.store.includes('MEGA')));
assert.ok(!merged.some(item => item.source === 'パチスロ100' && item.date === '2026-11-07' &&
  item.media === 'スロパチステーション' && item.store.includes('MEGA')));

// 11/1 マルハン梅田は2件（れんじろう・宴）のまま
const umeda = merged.filter(item => item.date === '2026-11-01' && item.store === 'マルハン梅田店' && item.media === 'スロパチステーション');
assert.deepEqual(umeda.map(item => item.event).sort(), ['スロパチ来店取材“宴”', 'れんじろう実践来店(赤)'].sort());

// スロパチ公式が失敗した日は、前回のスロパチ行を基準に重複を除く
const anchored = run('eventMergeSlopachiDuplicates(p100Records, [{date:"2026-10-31", store:"マルハン加島店", source:"スロパチ公式", status:"有効"}])');
assert.ok(!anchored.some(item => item.source === 'パチスロ100' && item.date === '2026-10-31' && item.store === 'マルハン加島店'));

// 既存行との関係: 同じ取材名なら行を引き継ぎ、違う取材名なら旧行を消失にして新行を足す
context.prior = [
  {rowNumber:2, key:'2026-10-31|マルハン加島店|スロパチステーション来店取材(オレンジ)',
    date:'2026-10-31', store:'マルハン加島店', event:'スロパチステーション来店取材(オレンジ)',
    source:'パチスロ100', status:'有効', firstSeen:'前回'},
  {rowNumber:3, key:'2026-11-07|マルハンなんば本館|じゃんじゃん来店(青)',
    date:'2026-11-07', store:'マルハンなんば本館', event:'じゃんじゃん来店(青)',
    source:'パチスロ100', status:'有効', firstSeen:'前回'},
];
context.recs = merged.filter(item =>
  (item.date === '2026-10-31' && item.store === 'マルハン加島店') ||
  (item.date === '2026-11-07' && item.store === 'マルハンなんば本館'));
const diff = run("eventDiff(prior, recs, ['パチスロ100','スロパチ公式'], '今回', '2026-10-30')");
assert.ok(diff.updated.some(item => item.rowNumber === 2 && item.source === 'スロパチ公式'));
assert.ok(diff.disappeared.some(item => item.rowNumber === 3));
assert.ok(diff.added.some(item => item.store === 'マルハンなんば本館' && item.source === 'スロパチ公式'));

// =============================================
// 3. 中継のエラー文言
// =============================================
function properties(values) {
  context.PropertiesService = {getScriptProperties: () => ({getProperty: key => values[key] || null})};
}
function relay(body, code) {
  context.UrlFetchApp = {fetch: url => {
    context.relayUrl = url;
    return {getResponseCode: () => code, getContentText: () => body};
  }};
}
const throws = (call, pattern) => assert.throws(() => vm.runInContext(call, context), pattern);

properties({});
throws('eventFetchRelay("kansai")', /中継URLが未設定/);
properties({SLOPACHI_RELAY_URL:'https://relay.test/api/slopachi'});
throws('eventFetchRelay("kansai")', /中継トークンが未設定/);
properties({SLOPACHI_RELAY_URL:'https://relay.test/api/slopachi', SLOPACHI_RELAY_TOKEN:'secret'});

relay(JSON.stringify({status:200, page:'kansai', html:'<html>OK</html>'}), 200);
assert.equal(vm.runInContext('eventFetchRelay("kansai")', context), '<html>OK</html>');
assert.ok(context.relayUrl.indexOf('page=kansai') >= 0);
assert.ok(context.relayUrl.indexOf('token=secret') >= 0);

relay(JSON.stringify({status:403, page:'kansai', html:''}), 200);
throws('eventFetchRelay("kansai")', /中継も403/);
relay('', 403);
throws('eventFetchRelay("kansai")', /中継も403/);
relay(JSON.stringify({status:500, page:'kansai', html:''}), 200);
throws('eventFetchRelay("kansai")', /中継HTTP 500/);
relay(JSON.stringify({status:200, page:'kansai', html:''}), 200);
throws('eventFetchRelay("kansai")', /中継のHTMLが空です/);

console.log('PASS: スロパチの色付き読み取り25件、重複20件のまとめ、5件の追加、中継のエラー文言');
