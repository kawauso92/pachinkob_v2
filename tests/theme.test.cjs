// 見た目（appb）の表示用の純関数と、CSSの切り替えのテスト。
// 既存の tests/event_view.test.cjs と同じ方式で script 全体を vm に読み込む。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// --- <html> のクラスとlocalStorageの代わり（見た目の読み書きを確認する） ---
const htmlClass = new Set(['theme-race', 'font-titillium']);
const store = new Map();
const elStub = () => ({
  dataset: {}, style: {}, textContent: '', innerHTML: '',
  setAttribute() {}, getAttribute() { return null; },
  querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
});
const context = vm.createContext({
  window: { addEventListener() {} },
  document: {
    addEventListener() {},
    documentElement: {
      classList: {
        add: (...c) => c.forEach(x => htmlClass.add(x)),
        remove: (...c) => c.forEach(x => htmlClass.delete(x)),
        contains: c => htmlClass.has(c),
        toggle: (c, on) => { on ? htmlClass.add(c) : htmlClass.delete(c); },
      },
    },
    getElementById() { return elStub(); },
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
// 期待時給の段階（保留の色）
// =============================================
assert.deepEqual(plain(call('KITAI_THRESHOLDS')),
  { warn: 1500, ok: 1800, good: 2200, great: 2600, rainbow: 3000 }, '段階の金額は appa の初期値と同じ');
assert.deepEqual(plain(call('KITAI_TIER_NAMES')),
  ['見送り', '及第', '合格', '良台', '神台', '虹']);

for (const [v, expected] of [
  [1499, 0], [1500, 1], [1799, 1], [1800, 2], [2199, 2], [2200, 3],
  [2599, 3], [2600, 4], [2999, 4], [3000, 5], [9999, 5], [0, 0], [-500, 0],
]) {
  assert.equal(call(`kitaiTier(${v}, KITAI_THRESHOLDS)`), expected, `kitaiTier(${v})`);
}
for (const v of ['', 'abc', undefined, null]) {
  assert.equal(call(`kitaiTier(${JSON.stringify(v)}, KITAI_THRESHOLDS)`), -1, `kitaiTier(${JSON.stringify(v)}) は -1`);
}
assert.equal(call("kitaiTier('2400', KITAI_THRESHOLDS)"), 3, '文字列の数字も見る');

// kitaiTierStyle（appa と同じ形：color＝帯、number＝数字、rainbow＝虹）
assert.deepEqual(plain(call('kitaiTierStyle(-1)')), { color: 'var(--fg2)', number: 'var(--fg2)', label: '—', rainbow: false });
assert.deepEqual(plain(call('kitaiTierStyle(0)')), { color: 'var(--t0)', number: 'var(--fg2)', label: '見送り', rainbow: false });
assert.deepEqual(plain(call('kitaiTierStyle(1)')), { color: 'var(--t1)', number: 'var(--fg)', label: '及第', rainbow: false });
assert.deepEqual(plain(call('kitaiTierStyle(2)')), { color: 'var(--t2)', number: 'var(--t2)', label: '合格', rainbow: false });
assert.deepEqual(plain(call('kitaiTierStyle(3)')), { color: 'var(--t3)', number: 'var(--t3)', label: '良台', rainbow: false });
assert.deepEqual(plain(call('kitaiTierStyle(4)')), { color: 'var(--t4)', number: 'var(--t4)', label: '神台', rainbow: false });
assert.deepEqual(plain(call('kitaiTierStyle(5)')), { color: 'var(--rainbow)', number: 'var(--rainbow)', label: '虹', rainbow: true });

// kitaiCls（数字に付けるクラス）
assert.equal(call('kitaiCls(2400)'), 'tier-3');
assert.equal(call('kitaiCls(3200)'), 'tier-5', '虹は tier-5');
assert.equal(call('kitaiCls(1000)'), 'tier-0');
assert.equal(call('kitaiCls(null)'), '');
assert.equal(call("kitaiCls('')"), '');

// =============================================
// 見た目・書体の選択（読み書きはtry/catch）
// =============================================
assert.equal(call("parseThemeStyle('meter')"), 'meter');
assert.equal(call("parseThemeStyle('race')"), 'race');
assert.equal(call("parseThemeStyle('なにか')"), 'race', '不正な値はレース');
assert.equal(call('parseThemeStyle(null)'), 'race');
assert.equal(call("parseThemeFont('michroma')"), 'michroma');
assert.equal(call("parseThemeFont('titillium')"), 'titillium');
assert.equal(call("parseThemeFont('なにか')"), 'titillium', '不正な値は Titillium');
assert.deepEqual(plain(call("themeClasses('meter','michroma')")), ['theme-meter', 'font-michroma']);
assert.deepEqual(plain(call("themeClasses(null,null)")), ['theme-race', 'font-titillium']);

// 初期は 見た目1・Titillium
assert.ok(html.includes('<html lang="ja" class="theme-race font-titillium">'), '初期は theme-race font-titillium');
assert.ok(script.includes("let themeStyle = 'race'") && script.includes("let themeFont  = 'titillium'"), '初期値はレース・Titillium');

// applyTheme でクラスが入れ替わる
call("applyTheme('meter','michroma')");
assert.ok(htmlClass.has('theme-meter') && !htmlClass.has('theme-race'), 'theme-meter に切り替わる');
assert.ok(htmlClass.has('font-michroma') && !htmlClass.has('font-titillium'), 'font-michroma に切り替わる');
// 再描画は今のタブだけ（描画しないタブへ寄せて、DOMスタブに触らせない）
call("currentTab = 'none'");
call("setThemeStyle('race')");
call("setThemeFont('titillium')");
assert.ok(htmlClass.has('theme-race') && !htmlClass.has('theme-meter'));
assert.ok(htmlClass.has('font-titillium') && !htmlClass.has('font-michroma'));

// 保存と読み出し（appb の localStorage）
assert.equal(store.get('theme_style'), 'race');
assert.equal(store.get('theme_font'), 'titillium');
call("setThemeStyle('meter')");
call("setThemeFont('michroma')");
assert.equal(store.get('theme_style'), 'meter');
assert.equal(store.get('theme_font'), 'michroma');
assert.deepEqual(plain(call('readTheme()')), { style: 'meter', font: 'michroma' });
store.set('theme_style', 'こわれた値');
assert.deepEqual(plain(call('readTheme()')), { style: 'race', font: 'michroma' }, '保存値が不正なら既定に戻す');

// 「さらに暗く」
call('loadNightMode()');
assert.equal(htmlClass.has('night'), false, '保存が無ければ暗くしない');
call('toggleNightMode()');
assert.equal(htmlClass.has('night'), true);
assert.equal(store.get('night_mode'), '1');
call('toggleNightMode()');
assert.equal(htmlClass.has('night'), false);
assert.equal(store.get('night_mode'), '0');
store.set('night_mode', '1');
call('loadNightMode()');
assert.equal(htmlClass.has('night'), true, '保存値から復元する');
assert.equal(call('isRaceTheme()'), false, '今は見た目2');
call("setThemeStyle('race')");
assert.equal(call('isRaceTheme()'), true, '見た目1に戻せる');

// =============================================
// CSS（appa と同じトークン・書体・部品）
// =============================================
const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
for (const token of ['--ink', '--panel', '--rule', '--line', '--raise', '--fg', '--fg2', '--fg3',
  '--t0', '--t1', '--t2', '--t3', '--t4', '--rainbow', '--plus', '--minus', '--warn', '--focus']) {
  assert.ok(styleBlock.includes(token + ':') || styleBlock.includes(token + ' :'), `${token} を持っている`);
}
// 古い色のトークンは残っていない
for (const old of ['--surface2', '--surface3', '--accent', '--magenta', '--bg:']) {
  assert.ok(!styleBlock.includes(old + ':'), `${old} は使わない`);
}
for (const oldVar of ['var(--bg)', 'var(--surface', 'var(--accent', 'var(--text2', 'var(--text3', 'var(--green', 'var(--red', 'var(--magenta', 'var(--border', 'var(--radius']) {
  assert.ok(!html.includes(oldVar), `${oldVar} は使わない`);
}
// 書体（appa と同じ切り替え）・方眼の背景・光る効果を消す
assert.ok(html.includes('Titillium+Web') && html.includes('Michroma') && html.includes('Saira+Semi+Condensed') && html.includes('IBM+Plex+Sans+JP') && html.includes('Zen+Kaku+Gothic+New'), 'appa と同じ書体を読み込む');
assert.ok(!html.includes('Rajdhani') && !html.includes('JetBrains Mono'), 'Rajdhani と JetBrains Mono は使わない');
assert.ok(!html.includes('body::before'), '方眼の背景はない');
assert.ok(!html.includes('backdrop-filter'), '光る効果（ぼかし）はない');
assert.ok(styleBlock.includes('.night{'), 'さらに暗くのトークンがある');
assert.ok(styleBlock.includes('.theme-race{') && styleBlock.includes('.theme-meter{'), '見た目の切り替えがある');
assert.ok(styleBlock.includes('.tier-5{') && styleBlock.includes('-webkit-background-clip:text'), '虹は文字の中のグラデーション');
// appa の部品（板・行・チップ・入力欄・スイッチ）
assert.ok(styleBlock.includes('.chip.active'), 'チップは選択中に反転する');
assert.ok(styleBlock.includes('.switch[aria-pressed="true"]'), '切り替えスイッチがある');
assert.ok(styleBlock.includes('.seg button[aria-pressed="true"]'), 'セグメントがある');
assert.ok(styleBlock.includes('.set-input[type=number]'), '入力欄は appa の形（数字は font-num）');

// 設定（報酬・設定タブ）に見た目・書体・さらに暗くの切り替えがある
assert.ok(html.includes('id="theme-seg"') && html.includes('id="font-seg"') && html.includes('id="night-toggle"'));
assert.ok(html.includes('>1</button>') && html.includes('>2</button>'), '見た目のボタンは数字だけ');
assert.ok(html.includes('>Titillium</button>') && html.includes('>Michroma</button>'));
// 下部ナビは線のアイコン（絵文字なし）
assert.equal((html.match(/class="nav-btn/g) || []).length, 6);
assert.equal((html.match(/<svg class="icon"/g) || []).length, 6, 'ナビは線のアイコン6つ');
assert.ok(!/\p{Extended_Pictographic}/u.test(html), '絵文字を使わない');
// 英大文字のラベルを消す
const htmlBody = html.slice(0, html.indexOf('<script>'));
for (const label of ['SESSIONS', 'TOTAL', 'WIN RATE', 'LOADING', 'EVENTS', 'REWARD SUMMARY']) {
  assert.ok(!htmlBody.includes(label), `${label} のラベルはない`);
}
for (const label of ["'ALL'", 'Avg mochi', 'OWNER', 'JetBrains']) {
  assert.ok(!script.includes(label), `表示に ${label} を使わない`);
}

console.log('PASS: 期待時給の段階の色、見た目・書体・さらに暗くの切り替えと保存、appa と同じ色のトークン');
