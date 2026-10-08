/**
 * イベント収集用の解析関数（純関数のみ）。
 *
 * GAS（UrlFetchApp等）にも Node（テスト）にも依存しない。
 * 入力はHTML文字列、出力は
 *   { date:'YYYY-MM-DD', store, area, kind, event, media, note, source, source_url }
 * の配列。大阪以外は捨てる。年は既存Pythonの resolve_year（基準日から±180日）と同じ規則。
 *
 * 仕様: docs/20261008_pachinko-events-gas-plan.md の「各サイトの解析仕様」「自動判定」
 */

// 収集元のURLと表示名
var EVENT_SOURCE_PACHISURO100 = 'パチスロ100';
var EVENT_SOURCE_AIMS = 'エイムスター';
var EVENT_SOURCE_JANBARI = 'ジャンバリ';
var EVENT_SOURCE_TAMADOJO = 'たま道場';
var PACHISURO100_URL = 'https://pachisuro100.com/osaka-schedule/';
var JANBARI_URL = 'https://jb-portal.com/schedule/?report_id=5';
var TAMADOJO_URL = 'https://tama-dojo.com/';
var OSAKA_TEXT = '大阪';
var JANBARI_EVENT_NAME = 'じゃんばり潜入来店取材';

// たま道場: 取材種別 → 取材名（既存 waasan.py と同じ）
var TAMADOJO_EVENT_NAME_BY_TYPE = {
  '玉道場': 'わーさん玉道場',
  '道場破り': 'わーさん道場破り',
  '入門': 'わーさん入門'
};

// パチスロ100: バッジclass → 種別（既存サイトの表示に対応）
var PACHISURO100_BADGE_KIND = {
  'badge-survey': '取材',
  'badge-visit': '来店',
  'badge-old-event': '旧イベント日',
  'badge-anniversary': '周年日',
  'badge-establishment': '創業日',
  'badge-character-birthday': 'キャラ誕'
};

var MS_PER_DAY = 24 * 60 * 60 * 1000;
var YEAR_WINDOW_DAYS = 180;

// =============================================
// 基本ユーティリティ
// =============================================

// 連続する空白（全角スペース含む）を1つにし、前後を除去する
function evCleanText(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function evPad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function evFormatYmd(year, month, day) {
  return year + '-' + evPad2(month) + '-' + evPad2(day);
}

// 基準日をDateへ正規化する（Date/ISO文字列/数値を受け付ける）
function evToReferenceDate(referenceDate) {
  if (referenceDate && Object.prototype.toString.call(referenceDate) === '[object Date]') {
    return referenceDate;
  }
  if (typeof referenceDate === 'string' || typeof referenceDate === 'number') {
    var parsed = new Date(referenceDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * 月日から年を推定する（既存Pythonの resolve_year と同じ: 基準日から±180日）。
 * 戻り値は 'YYYY-MM-DD'。
 */
function resolveYear(month, day, referenceDate) {
  var ref = evToReferenceDate(referenceDate);
  var refYear = ref.getUTCFullYear();
  var refTime = Date.UTC(refYear, ref.getUTCMonth(), ref.getUTCDate());
  var candidate = Date.UTC(refYear, month - 1, day);
  if (candidate < refTime - YEAR_WINDOW_DAYS * MS_PER_DAY) {
    candidate = Date.UTC(refYear + 1, month - 1, day);
  } else if (candidate > refTime + YEAR_WINDOW_DAYS * MS_PER_DAY) {
    candidate = Date.UTC(refYear - 1, month - 1, day);
  }
  var d = new Date(candidate);
  return evFormatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// 「M月D日(曜)」から 'YYYY-MM-DD' を得る。見つからなければ null
function parseJpDate(text, referenceDate) {
  var m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(String(text === null || text === undefined ? '' : text));
  if (!m) return null;
  return resolveYear(parseInt(m[1], 10), parseInt(m[2], 10), referenceDate);
}

// 「YYYY/MM/DD」から 'YYYY-MM-DD' を得る。見つからなければ null
function parseSlashDate(text) {
  var m = /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/.exec(String(text === null || text === undefined ? '' : text));
  if (!m) return null;
  return evFormatYmd(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

// 台帳キー: 日付＋店＋取材名（前後空白除去・全角/半角空白を1つに）
function eventKey(record) {
  if (!record) return '';
  return [
    evCleanText(record.date),
    evCleanText(record.store),
    evCleanText(record.event)
  ].join('|');
}

// =============================================
// 自動判定（計画書「自動判定」）
// =============================================
function autoTarget(eventName, media, note) {
  var name = evCleanText(eventName);
  var medium = evCleanText(media);
  var memo = evCleanText(note);

  // 1. 取材名に「玉」「(P)」「PS」→ P（「PS」は PS）
  if (name.indexOf('PS') >= 0) return 'PS';
  if (name.indexOf('玉') >= 0 || name.indexOf('(P)') >= 0 || name.indexOf('（P）') >= 0) return 'P';

  // 2. 媒体がスロパチステーションで、取材名に「(黒)」→ P、「(青)」→ PS
  if (medium.indexOf('スロパチステーション') >= 0) {
    if (name.indexOf('(黒)') >= 0 || name.indexOf('（黒）') >= 0) return 'P';
    if (name.indexOf('(青)') >= 0 || name.indexOf('（青）') >= 0) return 'PS';
  }

  // 3. パチスロ100の補足に「パチンコ」→ P（「パチスロ」も含めば PS）
  if (memo.indexOf('パチンコ') >= 0) {
    return memo.indexOf('パチスロ') >= 0 ? 'PS' : 'P';
  }

  // 4. 末尾「来店S」→ S
  if (/来店S\s*$/.test(name)) return 'S';

  // 5. それ以外 → S
  return 'S';
}

// =============================================
// HTML→テキスト
// =============================================
function evSafeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch (e) {
    return '';
  }
}

// 実体参照（&amp; &#123; &#x1f; 等）を復元する（&amp;は最後に処理する）
function evDecodeEntities(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) { return evSafeCodePoint(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return evSafeCodePoint(parseInt(dec, 10)); })
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&times;/g, '\u00d7')
    .replace(/&amp;/g, '&');
}

function evStripTags(value) {
  return String(value === null || value === undefined ? '' : value).replace(/<[^>]*>/g, '');
}

// HTML断片を1行のテキストにする
function evHtmlToText(html) {
  return evCleanText(evDecodeEntities(evStripTags(html)));
}

// HTML全体を改行区切りの行配列にする（script/style/コメントは除外）
function htmlToLines(html) {
  var s = String(html === null || html === undefined ? '' : html);
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '\n');
  s = s.replace(/<!--[\s\S]*?-->/g, '\n');
  s = s.replace(/<[^>]*>/g, '\n');
  s = evDecodeEntities(s);
  var lines = s.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = evCleanText(lines[i]);
    if (line !== '') out.push(line);
  }
  return out;
}

// =============================================
// 共通レコード生成
// =============================================
function evMakeRecord(date, store, area, kind, event, media, note, source, sourceUrl) {
  return {
    date: date || '',
    store: store || '',
    area: area || '',
    kind: kind || '',
    event: event || '',
    media: media || '',
    note: note || '',
    source: source || '',
    source_url: sourceUrl || ''
  };
}

// 「取材名（媒体）」を末尾の括弧で分離する（取材名自体に括弧がある場合は最後をmediaとする）
function evSplitEventMedia(text) {
  var value = evCleanText(text);
  var m = /^(.*?)[（(]([^（）()]*)[）)]\s*$/.exec(value);
  if (m) {
    return { event: evCleanText(m[1]), media: evCleanText(m[2]) };
  }
  return { event: value, media: '' };
}

// =============================================
// パチスロ100（大阪スケジュール）
// =============================================
// `<div class="event-section">` を単位に、1店舗1日を解析する
function parsePachisuro100(html, referenceDate) {
  var out = [];
  try {
    var source = String(html === null || html === undefined ? '' : html);
    var starts = [];
    var headRe = /<div[^>]*class="[^"]*event-section[^"]*"[^>]*>/g;
    var hm;
    while ((hm = headRe.exec(source)) !== null) starts.push(hm.index);

    for (var i = 0; i < starts.length; i++) {
      var end = (i + 1 < starts.length) ? starts[i + 1] : source.length;
      parsePachisuro100Section(source.slice(starts[i], end), referenceDate, out);
    }
  } catch (e) {
    // 壊れたHTMLでも例外にしない（解析できた分だけ返す）
    return out;
  }
  return out;
}

// 1つの event-section を解析して out に追加する
function parsePachisuro100Section(section, referenceDate, out) {
  // ヘッダ（日付・バッジ）と店名の領域を切り出す
  var headerStart = section.indexOf('event-header');
  var storeStart = section.search(/<div[^>]*class="[^"]*store-name/);
  var headerChunk = (headerStart >= 0 && storeStart > headerStart)
    ? section.slice(headerStart, storeStart)
    : section.slice(0, 600);

  var dateMatch = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(headerChunk);
  var date = dateMatch ? parseSlashDate(dateMatch[1]) : null;
  if (!date) return;

  var area = '';
  var kinds = [];
  var badgeRe = /<span[^>]*class="[^"]*\b(badge-[a-z-]+)\b[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  var bm;
  while ((bm = badgeRe.exec(headerChunk)) !== null) {
    var cls = bm[1];
    var label = evHtmlToText(bm[2]);
    if (cls === 'badge-region') {
      area = label;
    } else if (PACHISURO100_BADGE_KIND[cls]) {
      kinds.push(PACHISURO100_BADGE_KIND[cls]);
    }
  }

  // 店名（複数あり。キャラ誕は複数行）
  var storeNames = [];
  var storeRe = /<div[^>]*class="[^"]*store-name[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  var sm;
  while ((sm = storeRe.exec(section)) !== null) {
    var strongMatch = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(sm[1]);
    var name = strongMatch ? evHtmlToText(strongMatch[1]) : evHtmlToText(sm[1]);
    name = name.replace(/^[・\s\u3000]+/, '');
    if (name) storeNames.push(name);
  }

  // 周年日・創業日・キャラ誕は「店の情報」として店名ごとに1件
  var primaryKind = kinds.indexOf('取材') >= 0 ? '取材'
    : kinds.indexOf('来店') >= 0 ? '来店'
    : (kinds[0] || '');
  if (primaryKind === '周年日' || primaryKind === '創業日' || primaryKind === 'キャラ誕') {
    for (var s = 0; s < storeNames.length; s++) {
      out.push(evMakeRecord(date, storeNames[s], area, primaryKind, primaryKind, '', '',
        EVENT_SOURCE_PACHISURO100, PACHISURO100_URL));
    }
    return;
  }

  var store = storeNames.length ? storeNames[0] : '';

  // event-info 行（・取材名（媒体） / 　⇒補足 / ・旧イベント日（…））
  var infoRe = /<div[^>]*class="[^"]*event-info[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  var im;
  var last = null;
  while ((im = infoRe.exec(section)) !== null) {
    var item = evHtmlToText(im[1]);
    if (!item) continue;
    if (item.indexOf('当日の入場情報') >= 0) break;

    if (item.charAt(0) === '⇒') {
      if (last) {
        var extra = evCleanText(item.slice(1));
        last.note = last.note ? (last.note + ' / ' + extra) : extra;
      }
      continue;
    }
    if (item.charAt(0) !== '・') continue; // ・で始まらない行は取材ではない

    var line = evCleanText(item.slice(1).replace(/^[・\s\u3000]+/, ''));
    if (line === '') continue;

    if (line.indexOf('旧イベント日') === 0) {
      var oldParts = evSplitEventMedia(line);
      last = evMakeRecord(date, store, area, '旧イベント日', '旧イベント日', '', oldParts.media,
        EVENT_SOURCE_PACHISURO100, PACHISURO100_URL);
      out.push(last);
      continue;
    }

    var parts = evSplitEventMedia(line);
    if (!parts.event) continue;
    last = evMakeRecord(date, store, area, primaryKind, parts.event, parts.media, '',
      EVENT_SOURCE_PACHISURO100, PACHISURO100_URL);
    out.push(last);
  }
}

// =============================================
// エイムスター（a.c-schedule__item / 既存 aims.py と同じ規則）
// =============================================
function parseAims(html, url, eventName, referenceDate) {
  var out = [];
  try {
    var source = String(html === null || html === undefined ? '' : html);
    var itemRe = /<a\b[^>]*class="[^"]*c-schedule__item[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = itemRe.exec(source)) !== null) {
      var chunk = m[1];
      var dateText = cacheInnerText(chunk, 'c-schedule__date');
      var areaText = cacheInnerText(chunk, 'c-schedule__area');
      var titleText = cacheInnerText(chunk, 'c-schedule__title');
      if (!dateText || !areaText || !titleText) continue;

      var area = evCleanText(areaText);
      if (area !== OSAKA_TEXT) continue;

      var date = parseJpDate(dateText, referenceDate);
      var store = evCleanText(titleText);
      if (!date || !store) continue;

      out.push(evMakeRecord(date, store, OSAKA_TEXT, '取材', eventName, '', '',
        EVENT_SOURCE_AIMS, url));
    }
  } catch (e) {
    return out;
  }
  return out;
}

// class名で要素の内側テキストを取り出す小さなヘルパー（入れ子タグは除去）
function cacheInnerText(chunk, className) {
  var re = new RegExp('<[^>]*class="[^"]*' + className + '[^"]*"[^>]*>([\\s\\S]*?)<\\/', 'g');
  var m = re.exec(chunk);
  return m ? evHtmlToText(m[1]) : '';
}

// =============================================
// ジャンバリ（既存 janbari.py と同じ規則: 日付/都道府県/店名/取材名の4行組）
// =============================================
function parseJanbari(html, referenceDate) {
  var out = [];
  try {
    var lines = htmlToLines(html);
    var index = 0;
    while (index < lines.length) {
      var date = parseJpDate(lines[index], referenceDate);
      if (!date) {
        index += 1;
        continue;
      }
      if (index + 3 >= lines.length) break;
      var prefecture = lines[index + 1];
      var store = lines[index + 2];
      var eventText = lines[index + 3];
      if (prefecture === OSAKA_TEXT && eventText === JANBARI_EVENT_NAME) {
        out.push(evMakeRecord(date, store, OSAKA_TEXT, '取材', JANBARI_EVENT_NAME, '', '',
          EVENT_SOURCE_JANBARI, JANBARI_URL));
      }
      index += 4;
    }
  } catch (e) {
    return out;
  }
  return out;
}

// =============================================
// たま道場（既存 waasan.py と同じ規則）
// =============================================
function parseTamaDojo(html, referenceDate) {
  var out = [];
  try {
    var rawLines = htmlToLines(html);
    var lines = [];
    for (var k = 0; k < rawLines.length; k++) {
      lines.push(evCleanText(rawLines[k].replace(/^[・\s\u3000]+/, '')));
    }
    var currentDate = null;
    for (var index = 0; index < lines.length; index++) {
      var parsed = parseJpDate(lines[index], referenceDate);
      if (parsed) {
        currentDate = parsed;
        continue;
      }
      if (lines[index] !== OSAKA_TEXT || !currentDate) continue;
      if (index + 2 >= lines.length) continue;
      var eventType = lines[index + 1];
      var store = lines[index + 2];
      var eventName = TAMADOJO_EVENT_NAME_BY_TYPE[eventType];
      if (!eventName || !store || TAMADOJO_EVENT_NAME_BY_TYPE[store]) continue;
      out.push(evMakeRecord(currentDate, store, OSAKA_TEXT, '取材', eventName, '', '',
        EVENT_SOURCE_TAMADOJO, TAMADOJO_URL));
    }
  } catch (e) {
    return out;
  }
  return out;
}
