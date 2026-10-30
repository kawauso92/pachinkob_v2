// 大阪イベントの収集。外部取得・解析はロック外、シート更新だけをロック内で実行する。
const EVENT_HEADERS = ['キー','日付','店','市区','種別','取材名','媒体','補足','収集元','出典URL','初回取得','最終確認','状態'];
const EVENT_JUDGEMENT_HEADERS = ['取材名','媒体','対象(P|S|PS)','採用(採用|除外|未判定)','推測される公約','根拠','メモ'];
const EVENT_STATUS_HEADERS = ['収集元','最終実行','結果(成功|失敗)','件数','最終日付','エラー','前回件数'];
const EVENT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const EVENT_AIMS_URLS = [
  ['https://aims777.com/syuzai/aimstar_gyoku/', 'エイムスター玉'],
  ['https://aims777.com/syuzai/aimstar_chogyoku/', 'エイムスター超玉']
];
// 0件が普通の収集元（0件では警告しない。失敗の警告は出す）
const EVENT_NO_ZERO_WARNING_SOURCES = [EVENT_SOURCE_AIMS, EVENT_SOURCE_TAMADOJO];

function eventToday() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function eventNow() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'); }
function eventDay(date, offset) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

// 同じキーは1行にし、既存の初回取得を保つ。失敗元と過去行は消失にしない。
function eventDiff(rows, records, successfulSources, now, today) {
  const prior = new Map(rows.map(item => [item.key, item]));
  const seen = new Set();
  const added = [], updated = [], disappeared = [];
  records.forEach(record => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '') || !record.store || !record.event) return;
    const key = eventKey(record);
    if (seen.has(key)) return;
    seen.add(key);
    const old = prior.get(key);
    if (old && old.date < today) return;
    const next = {...record, key, rowNumber:old ? old.rowNumber : null,
      firstSeen:old ? old.firstSeen : now, lastSeen:now, status:'有効'};
    (old ? updated : added).push(next);
  });
  rows.forEach(old => {
    if (old.date >= today && old.status === '有効' && successfulSources.includes(old.source) && !seen.has(old.key)) {
      disappeared.push({...old, status:'消失'});
    }
  });
  return {added, updated, disappeared};
}

// 前回まで1件以上あったのに今回0件なら、読み取りが壊れた可能性として警告する。
// previousCount は「最後に1件以上取れたときの件数」（無ければ0）。
// エイムスター・たま道場は0件が普通なので、0件では警告しない（失敗は警告する）。
function eventStatusWarning(status, today) {
  if (status.result !== '成功') return true;
  if (EVENT_NO_ZERO_WARNING_SOURCES.indexOf(status.source) < 0 &&
      Number(status.count) === 0 && Number(status.previousCount) > 0) return true;
  return status.source === EVENT_SOURCE_PACHISURO100 &&
    (Number(status.count) === 0 || !status.lastDate || status.lastDate < eventDay(today, 3));
}

// 店名の表記ゆれ（MEGAFACE→MEGAフェイス、末尾の「店」、記号、空白）を吸収する
function eventStoreKey(value) {
  const key = String(value === null || value === undefined ? '' : value).normalize('NFKC').toLowerCase()
    .replace(/[\s\u3000]+/g, '').replace(/megaface/g, 'megaフェイス').replace(/[・･.,，、]/g, '');
  if (key.length > 1 && key.charAt(key.length - 1) === '店') return key.slice(0, -1);
  return key;
}

function eventStoreMatches(left, right) {
  const a = eventStoreKey(left), b = eventStoreKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // 「マルハン」のような短い名前で別店舗に一致しないよう、5文字以上だけ部分一致を許す
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.indexOf(shorter) >= 0;
}

// 取材名から「取材の種類」を決める。色は含めない。
// 上から順に判定し、演者だけは演者名も種類の一部にする
// （「じゃんじゃん来店(青)」と「じゃんじゃん実践来店(青)」を同じにするため）。
function eventSlopachiKind(name) {
  const text = evCleanText(name).normalize('NFKC');
  for (let i = 0; i < SLOPACHI_PACHINKO_ACTORS.length; i++) {
    if (text.indexOf(SLOPACHI_PACHINKO_ACTORS[i]) >= 0) return '演者:' + SLOPACHI_PACHINKO_ACTORS[i];
  }
  if (text.indexOf('実践') >= 0) {
    const actor = text.split('実践')[0].replace(/[（(].*$/, '').trim();
    return '演者:' + (actor || '実践');
  }
  if (text.indexOf('ガール') >= 0) return 'ガール';
  if (text.indexOf('景品') >= 0) return '景品入荷';
  if (text.indexOf('収録') >= 0) return '番組収録';
  if (text.indexOf('宴') >= 0) return '宴';
  if (text.indexOf('来店取材') >= 0) return '来店取材';
  return 'その他';
}

// スロパチ公式とパチスロ100の同じ予定を1件にまとめる。
// 日付＋店名＋取材の種類が一致したときだけ同じ予定とみなし、
// 色付きのスロパチ公式を残す。パチスロ100にしか無い予定はそのまま残す。
// 種類が「その他」のものは安全側に倒してまとめない。
// anchorRows は「スロパチ公式が失敗した日に、前回のスロパチ行を残す」ための保険。
function eventMergeSlopachiDuplicates(records, anchorRows) {
  const slopachi = [], others = [];
  records.forEach(item => (item.source === EVENT_SOURCE_SLOPACHI ? slopachi : others).push(item));
  const seen = new Set();
  const kept = slopachi.filter(item => {
    const key = eventKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const anchors = kept.concat(anchorRows || []);
  const merged = others.filter(item => {
    if (evCleanText(item.media) !== 'スロパチステーション') return true;
    const kind = eventSlopachiKind(item.event);
    if (kind === 'その他') return true;
    return !anchors.some(anchor => anchor.date === item.date &&
      eventSlopachiKind(anchor.event) === kind && eventStoreMatches(anchor.store, item.store));
  });
  return merged.concat(kept);
}

function eventEventsForApp(rows, today) {
  const from = eventDay(today, -31), through = eventDay(today, 31);
  return rows.filter(item => item.status === '有効' && item.date >= from && item.date <= through)
    .map(item => ({date:item.date, store:item.store, area:item.area, kind:item.kind,
      event:item.event, media:item.media, note:item.note, source:item.source,
      source_url:item.source_url, last_seen:item.lastSeen}));
}

function eventSources(referenceDate) {
  return [
    {name:EVENT_SOURCE_PACHISURO100, requests:[{url:PACHISURO100_URL, parse:html => parsePachisuro100(html, referenceDate)}]},
    {name:EVENT_SOURCE_AIMS, requests:EVENT_AIMS_URLS.map(item =>
      ({url:item[0], parse:html => parseAims(html, item[0], item[1], referenceDate)}))},
    {name:EVENT_SOURCE_JANBARI, requests:[{url:JANBARI_URL, parse:html => parseJanbari(html, referenceDate)}]},
    {name:EVENT_SOURCE_TAMADOJO, requests:[{url:TAMADOJO_URL, parse:html => parseTamaDojo(html, referenceDate)}]},
    // スロパチ公式は日本のVercel中継（api/slopachi.js）経由で4ページを取る。
    // 直接取ると海外のGASからは403になるため。
    {name:EVENT_SOURCE_SLOPACHI, requests:Object.keys(SLOPACHI_PAGE_PATHS).map(page => {
      const url = SLOPACHI_ORIGIN + SLOPACHI_PAGE_PATHS[page];
      return {url, relayPage:page, parse:html => parseSlopachiJsonLd(html, url)};
    })}
  ];
}

function eventFetchHtml(url) {
  const response = UrlFetchApp.fetch(url, {muteHttpExceptions:true, headers:{'User-Agent':EVENT_USER_AGENT}});
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code);
  return response.getContentText('UTF-8');
}

// 中継（Vercel）から1ページ分のHTMLを取る。
// 中継のURLと合言葉はスクリプトプロパティから読み、コードには書かない。
function eventFetchRelay(page) {
  const properties = PropertiesService.getScriptProperties();
  const base = String(properties.getProperty('SLOPACHI_RELAY_URL') || '').trim();
  const token = String(properties.getProperty('SLOPACHI_RELAY_TOKEN') || '').trim();
  if (!base) throw new Error('中継URLが未設定');
  if (!token) throw new Error('中継トークンが未設定');
  const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'page=' + encodeURIComponent(page);
  // 合言葉はURLに載せず、ヘッダーで送る（Vercelのログに残さない）
  const response = UrlFetchApp.fetch(url, {headers:{'X-Relay-Token':token}, muteHttpExceptions:true});
  const code = response.getResponseCode();
  if (code === 403) throw new Error('中継も403');
  if (code < 200 || code >= 300) throw new Error('中継HTTP ' + code);
  let data;
  try {
    data = JSON.parse(response.getContentText('UTF-8'));
  } catch (error) {
    throw new Error('中継の応答がJSONではありません');
  }
  const status = Number(data && data.status);
  if (status === 403) throw new Error('中継も403');
  if (status !== 200) throw new Error('中継HTTP ' + (status || '不明'));
  const html = String((data && data.html) || '');
  if (!html) throw new Error('中継のHTMLが空です');
  return html;
}

// 同じ収集元の中で、同じ日付・店・取材名の重複を除く
// （スロパチは関西ページと演者ページで同じ予定が載るため）
function eventUniqueRecords(records) {
  const seen = new Set();
  return records.filter(item => {
    const key = eventKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventFetchSource(source, waitBeforeFetch) {
  const records = [];
  source.requests.forEach(request => {
    if (waitBeforeFetch()) Utilities.sleep(1000);
    const html = request.relayPage ? eventFetchRelay(request.relayPage) : eventFetchHtml(request.url);
    const parsed = request.parse(html);
    if (!Array.isArray(parsed)) throw new Error('解析結果が不正です');
    records.push(...parsed);
  });
  if (source.name === EVENT_SOURCE_PACHISURO100 && records.length === 0) throw new Error('収集件数が0件です');
  // スロパチだけ、関西ページと演者ページの同じ予定を1件にまとめる
  if (source.name === EVENT_SOURCE_SLOPACHI) return eventUniqueRecords(records);
  return records;
}

function collectAutoEvents() {
  const now = eventNow(), today = eventToday();
  let fetches = 0;
  const results = eventSources(today + 'T00:00:00Z').map(source => {
    try {
      const records = eventFetchSource(source, () => fetches++ > 0);
      const lastDate = records.reduce((max, item) => item.date > max ? item.date : max, '');
      return {source:source.name, result:'成功', count:records.length, lastDate, error:'', records};
    } catch (error) {
      return {source:source.name, result:'失敗', count:0, lastDate:'', error:String(error.message || error).slice(0, 500), records:[]};
    }
  });
  return AutoHoshu.withLock(() => eventApplyCollection(results, now, today));
}

function eventSheet(spreadsheet, name, headers, create) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet && create) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function eventCell(value, pattern) {
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Tokyo', pattern);
  return stockDisplayText(String(value === null || value === undefined ? '' : value));
}

function eventReadValues(sheet, width) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}

function eventReadRows(sheet) {
  return eventReadValues(sheet, 13).map((r, index) => ({rowNumber:index + 2,
    key:eventCell(r[0]), date:eventCell(r[1], 'yyyy-MM-dd'), store:eventCell(r[2]), area:eventCell(r[3]),
    kind:eventCell(r[4]), event:eventCell(r[5]), media:eventCell(r[6]), note:eventCell(r[7]),
    source:eventCell(r[8]), source_url:eventCell(r[9]), firstSeen:eventCell(r[10], 'yyyy-MM-dd HH:mm:ss'),
    lastSeen:eventCell(r[11], 'yyyy-MM-dd HH:mm:ss'), status:eventCell(r[12])
  })).filter(item => item.key);
}

function eventSafe(value) { return stockSheetText(String(value === null || value === undefined ? '' : value)); }
function eventRowValues(item) {
  return [item.key, item.date, item.store, item.area, item.kind, item.event, item.media,
    item.note, item.source, item.source_url, item.firstSeen, item.lastSeen, item.status].map(eventSafe);
}

// 連続した更新行をまとめ、GASのシート書き込み回数を抑える。
function eventWriteUpdates(sheet, items, width, valuesFor) {
  const sorted = items.slice().sort((a, b) => a.rowNumber - b.rowNumber);
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].rowNumber === sorted[end - 1].rowNumber + 1) end++;
    sheet.getRange(sorted[start].rowNumber, 1, end - start, width)
      .setValues(sorted.slice(start, end).map(valuesFor));
    start = end;
  }
}

function eventJudgementKey(item) { return evCleanText(item.event) + '\u0001' + evCleanText(item.media); }
function eventReadJudgements(sheet) {
  return eventReadValues(sheet, 7).map(r => ({event:eventCell(r[0]), media:eventCell(r[1]),
    target:eventCell(r[2]), adopt:eventCell(r[3]), pledge:eventCell(r[4]),
    basis:eventCell(r[5]), memo:eventCell(r[6])})).filter(item => item.event);
}

function eventAppendJudgements(sheet, records) {
  const known = new Set(eventReadJudgements(sheet).map(eventJudgementKey));
  const added = [];
  records.forEach(item => {
    if (['旧イベント日','周年日','創業日','キャラ誕'].includes(item.kind)) return;
    const key = eventJudgementKey(item);
    if (known.has(key)) return;
    known.add(key);
    added.push([item.event, item.media, autoTarget(item.event, item.media, item.note), '未判定', '', '', ''].map(eventSafe));
  });
  if (added.length) sheet.getRange(sheet.getLastRow() + 1, 1, added.length, 7).setValues(added);
  return added.length;
}

function eventStatusValues(item, now, previousCount) {
  return [item.source, now, item.result, item.count, item.lastDate, item.error, previousCount]
    .map((value, index) => index === 3 || index === 6 ? Number(value) || 0 : eventSafe(value));
}

// G列「前回件数」= 最後に1件以上取れたときの件数。
// 今回1件以上なら今回の件数、0件または失敗なら前の値を引き継ぐ。
function eventNextPreviousCount(item, previous) {
  const count = Number(item.count) || 0;
  if (item.result === '成功' && count > 0) return count;
  return Number(previous) || 0;
}

// G列が空の既存シート（6列）は、D列（前回の件数）を引き継ぐ
function eventPreviousCounts(sheet) {
  return new Map(eventReadValues(sheet, 7).map(row => {
    const stored = row[6];
    const empty = stored === '' || stored === null || stored === undefined;
    return [eventCell(row[0]), empty ? (Number(row[3]) || 0) : (Number(stored) || 0)];
  }));
}

// 既存シートに7列目が無ければ見出しを足す（既存の6列はそのまま）
function eventEnsureStatusHeader(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return;
  const header = sheet.getRange(1, 1, 1, 7).getValues()[0];
  if (eventCell(header[6]) !== '前回件数') sheet.getRange(1, 7).setValues([['前回件数']]);
}

function eventWriteStatuses(sheet, results, now, previousCounts) {
  const positions = new Map(eventReadValues(sheet, 7).map((row, index) => [eventCell(row[0]), index + 2]));
  results.forEach(item => {
    const rowNumber = positions.get(item.source) || sheet.getLastRow() + 1;
    const previous = previousCounts ? (previousCounts.get(item.source) || 0) : 0;
    const nextPrevious = eventNextPreviousCount(item, previous);
    sheet.getRange(rowNumber, 1, 1, 7).setValues([eventStatusValues(item, now, nextPrevious)]);
    positions.set(item.source, rowNumber);
  });
}

function eventApplyCollection(results, now, today) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const events = eventSheet(spreadsheet, '自動イベント', EVENT_HEADERS, true);
  const judgements = eventSheet(spreadsheet, '取材判定', EVENT_JUDGEMENT_HEADERS, true);
  const status = eventSheet(spreadsheet, '収集状態', EVENT_STATUS_HEADERS, true);
  const successful = results.filter(item => item.result === '成功');
  const priorRows = eventReadRows(events);
  const previousCounts = eventPreviousCounts(status);
  // スロパチ公式が失敗した日は、前回のスロパチ行を基準にパチスロ100の重複を除く。
  // そうしないと、失敗した日だけ同じ予定が2件並ぶ。
  const slopachiSucceeded = successful.some(item => item.source === EVENT_SOURCE_SLOPACHI);
  const anchors = slopachiSucceeded ? [] : priorRows.filter(item =>
    item.source === EVENT_SOURCE_SLOPACHI && item.status === '有効' && item.date >= today);
  const records = eventMergeSlopachiDuplicates(successful.flatMap(item => item.records), anchors);
  const diff = eventDiff(priorRows, records, successful.map(item => item.source), now, today);
  eventWriteUpdates(events, diff.updated.concat(diff.disappeared), 13, eventRowValues);
  if (diff.added.length) events.getRange(events.getLastRow() + 1, 1, diff.added.length, 13)
    .setValues(diff.added.map(eventRowValues));
  const newJudgements = eventAppendJudgements(judgements, records);
  eventEnsureStatusHeader(status);
  eventWriteStatuses(status, results, now, previousCounts);
  return {success:true, sources:results.map(({records:ignored, ...item}) => ({...item,
    previousCount:previousCounts.get(item.source) || 0,
    warning:eventStatusWarning({...item, previousCount:previousCounts.get(item.source) || 0}, today)})),
    added:diff.added.length, updated:diff.updated.length, disappeared:diff.disappeared.length, newJudgements};
}

function eventReadStatuses(sheet, today) {
  return eventReadValues(sheet, 7).map(r => {
    const stored = r[6];
    const empty = stored === '' || stored === null || stored === undefined;
    const item = {source:eventCell(r[0]), lastRun:eventCell(r[1], 'yyyy-MM-dd HH:mm:ss'),
      result:eventCell(r[2]), count:Number(r[3]) || 0, lastDate:eventCell(r[4], 'yyyy-MM-dd'),
      error:eventCell(r[5]),
      previousCount:empty ? (Number(r[3]) || 0) : (Number(stored) || 0)};
    return {...item, warning:eventStatusWarning(item, today)};
  }).filter(item => item.source);
}

function getAutoEventsForApp() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const today = eventToday();
  const events = eventReadRows(eventSheet(spreadsheet, '自動イベント', EVENT_HEADERS, false));
  const judgements = eventReadJudgements(eventSheet(spreadsheet, '取材判定', EVENT_JUDGEMENT_HEADERS, false));
  const status = eventReadStatuses(eventSheet(spreadsheet, '収集状態', EVENT_STATUS_HEADERS, false), today);
  return {events:eventEventsForApp(events, today), judgements, status,
    updatedAt:status.reduce((max, item) => item.lastRun > max ? item.lastRun : max, '')};
}

function setupAutoEventTrigger() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'collectAutoEvents')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('collectAutoEvents').timeBased().everyDays(1).atHour(6)
    .inTimezone('Asia/Tokyo').create();
}
