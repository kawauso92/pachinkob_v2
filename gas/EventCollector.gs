// 大阪イベントの収集。外部取得・解析はロック外、シート更新だけをロック内で実行する。
const EVENT_HEADERS = ['キー','日付','店','市区','種別','取材名','媒体','補足','収集元','出典URL','初回取得','最終確認','状態'];
const EVENT_JUDGEMENT_HEADERS = ['取材名','媒体','対象(P|S|PS)','採用(採用|除外|未判定)','推測される公約','根拠','メモ'];
const EVENT_STATUS_HEADERS = ['収集元','最終実行','結果(成功|失敗)','件数','最終日付','エラー'];
const EVENT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const EVENT_AIMS_URLS = [
  ['https://aims777.com/syuzai/aimstar_gyoku/', 'エイムスター玉'],
  ['https://aims777.com/syuzai/aimstar_chogyoku/', 'エイムスター超玉']
];

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

function eventStatusWarning(status, today) {
  if (status.result !== '成功') return true;
  return status.source === EVENT_SOURCE_PACHISURO100 &&
    (Number(status.count) === 0 || !status.lastDate || status.lastDate < eventDay(today, 3));
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
    {name:EVENT_SOURCE_SLOPACHI, requests:[{url:SLOPACHI_RENJIRO_URL, parse:html => parseSlopachiJsonLd(html, SLOPACHI_RENJIRO_URL)}]}
  ];
}

function eventFetchHtml(url) {
  const response = UrlFetchApp.fetch(url, {muteHttpExceptions:true, headers:{'User-Agent':EVENT_USER_AGENT}});
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code);
  return response.getContentText('UTF-8');
}

function eventFetchSource(source, waitBeforeFetch) {
  const records = [];
  source.requests.forEach(request => {
    if (waitBeforeFetch()) Utilities.sleep(1000);
    const parsed = request.parse(eventFetchHtml(request.url));
    if (!Array.isArray(parsed)) throw new Error('解析結果が不正です');
    records.push(...parsed);
  });
  if (source.name === EVENT_SOURCE_PACHISURO100 && records.length === 0) throw new Error('収集件数が0件です');
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

function eventStatusValues(item, now) {
  return [item.source, now, item.result, item.count, item.lastDate, item.error].map((value, index) =>
    index === 3 ? value : eventSafe(value));
}

function eventWriteStatuses(sheet, results, now) {
  const existing = eventReadValues(sheet, 6);
  const positions = new Map(existing.map((row, index) => [eventCell(row[0]), index + 2]));
  results.forEach(item => {
    const rowNumber = positions.get(item.source) || sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, 6).setValues([eventStatusValues(item, now)]);
    positions.set(item.source, rowNumber);
  });
}

function eventApplyCollection(results, now, today) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const events = eventSheet(spreadsheet, '自動イベント', EVENT_HEADERS, true);
  const judgements = eventSheet(spreadsheet, '取材判定', EVENT_JUDGEMENT_HEADERS, true);
  const status = eventSheet(spreadsheet, '収集状態', EVENT_STATUS_HEADERS, true);
  const successful = results.filter(item => item.result === '成功');
  const records = successful.flatMap(item => item.records);
  const diff = eventDiff(eventReadRows(events), records, successful.map(item => item.source), now, today);
  eventWriteUpdates(events, diff.updated.concat(diff.disappeared), 13, eventRowValues);
  if (diff.added.length) events.getRange(events.getLastRow() + 1, 1, diff.added.length, 13)
    .setValues(diff.added.map(eventRowValues));
  const newJudgements = eventAppendJudgements(judgements, records);
  eventWriteStatuses(status, results, now);
  return {success:true, sources:results.map(({records:ignored, ...item}) => ({...item,
    warning:eventStatusWarning(item, today)})), added:diff.added.length,
    updated:diff.updated.length, disappeared:diff.disappeared.length, newJudgements};
}

function eventReadStatuses(sheet, today) {
  return eventReadValues(sheet, 6).map(r => {
    const item = {source:eventCell(r[0]), lastRun:eventCell(r[1], 'yyyy-MM-dd HH:mm:ss'),
      result:eventCell(r[2]), count:Number(r[3]) || 0, lastDate:eventCell(r[4], 'yyyy-MM-dd'),
      error:eventCell(r[5])};
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
