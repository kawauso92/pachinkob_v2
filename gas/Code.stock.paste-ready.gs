// 全文置き換え用：追加のAutoHoshu.gsは不要です。
// 保存 → setupAutoHoshuを1回実行 → 既存デプロイを新バージョンへ更新。

// 公開リポジトリのためIDは載せない。GASに貼り付けた後、実際のスプレッドシートIDに置き換える。
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';

// ウォームアップ用（毎朝9時トリガーで実行）
function warmup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ss.getSheetByName('稼働記録').getLastRow();
}

function doPostLegacy(e) {
  try {
    const raw  = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);
    if (data.action === 'submit')            return submitRecord(data);
    if (data.action === 'delete')            return deleteRecord(data);
    if (data.action === 'saveMaster')        return saveMasterData(data);
    if (data.action === 'renameUchi')        return renameUchi(data);
    if (data.action === 'recalcUn')          return recalcUn(data);
    if (data.action === 'writeHoshu')        return writeHoshu(data);
    if (data.action === 'addManualEvent')    return addManualEvent(data);
    if (data.action === 'deleteManualEvent') return deleteManualEvent(data);
    if (data.action === 'saveEventNote')     return saveEventNote(data);
    return res({success: false, error: '不明なアクション'});
  } catch (err) {
    return res({success: false, error: err.message});
  }
}

function doGetLegacy(e) {
  try {
    const action   = e.parameter.action;
    const callback = e.parameter.callback;
    let result;

    if      (action === 'init')             result = getInit(e.parameter);
    else if (action === 'masters')          result = getMasters();
    else if (action === 'records')          result = getRecords(e.parameter);
    else if (action === 'getManualEvents')  result = getManualEvents();
    else if (action === 'getEventNotes')    result = getEventNotes();
    else result = {success: false, error: '不明なアクション'};

    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return res(result);
  } catch (err) {
    return res({success: false, error: err.message});
  }
}

function submitRecord(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('稼働記録');

  const hoshuDetail = calcHoshuDetail(
    sheet,
    data.date,
    data.uchi,
    data.kishu,
    data.soKaiten,
    data.sagitama,
    data.kitaiJikyu,
    data.genkinInvest
  );

  const hoshu = AutoHoshu.isManaged(data.date) ? 0 : hoshuDetail.final;
  const koujo = hoshuDetail.koujo;

  const unVal = (data.un !== '' && data.un !== null && data.un !== undefined)
    ? data.un / 100
    : '';

  let mochiRatio;
  if (data.mochiRatio !== undefined && data.mochiRatio !== null && data.mochiRatio !== '') {
    mochiRatio = parseFloat(data.mochiRatio);
  } else {
    const totalInvestBalls = (Number(data.choTamaInvest) || 0) + (Number(data.genkinInvestBalls) || 0);
    mochiRatio = totalInvestBalls > 0
      ? (Number(data.choTamaInvest) || 0) / totalInvestBalls
      : 1;
  }

  const row = [
    data.date,                         // A
    data.shop,                         // B
    data.kishu,                        // C
    data.daiban,                       // D
    data.uchi,                         // E
    data.kosshi,                       // F
    timeToSerial(data.jikan),          // G
    data.kitaiJikyu,                   // H
    data.shigoto,                      // I
    data.shigotoJikyu,                 // J
    data.soKaiten,                     // K
    data.kaitenRitsu,                  // L
    data.border,                       // M
    unVal,                             // N
    data.sagitama,                     // O
    hoshu,                             // P 報酬
    data.soRounds,                     // Q
    data.todayHits,                    // R
    data.hitBalls,                     // S
    data.jitsu1R,                      // T
    data.kariHoshu || 0,               // U 仮報酬
    mochiRatio,                        // V 持ち玉比率
    Number(data.genkinInvest) || 0,    // W 現金投資額
    koujo                              // X 控除額
  ];

  sheet.appendRow(row);
  const newRow = sheet.getLastRow();

  sheet.getRange(newRow, 7).setNumberFormat('[h]:mm');
  sheet.getRange(newRow, 11).setNumberFormat('0');
  sheet.getRange(newRow, 12).setNumberFormat('0.00');
  sheet.getRange(newRow, 13).setNumberFormat('0.00');
  sheet.getRange(newRow, 14).setNumberFormat('0.0%');
  sheet.getRange(newRow, 22).setNumberFormat('0.0%');

  return res({
    success: true,
    row: newRow,
    hoshu: hoshu,
    koujo: koujo,
    rate: hoshuDetail.rate,
    avgKitai: hoshuDetail.avgKitai
  });
}

function writeHoshu(data) {
  const row   = parseInt(data.row, 10);
  const hoshu = parseInt(data.hoshu, 10);
  if (!row || row < 2) return res({success: false, error: '無効な行番号'});
  if (isNaN(hoshu) || hoshu < 0) return res({success: false, error: '無効な報酬値'});

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('稼働記録');
  sheet.getRange(row, 16).setValue(hoshu);
  return res({success: true, row: row, hoshu: hoshu});
}

function deleteRecord(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('稼働記録');
  const row   = parseInt(data.row, 10);
  if (!row || row < 2) return res({success: false, error: '無効な行番号'});
  sheet.deleteRow(row);
  return res({success: true});
}

function recalcUn(data) {
  return res({success: true, updated: 0, message: '手動クリアしてください'});
}

function renameUchi(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('稼働記録');
  const last  = sheet.getLastRow();
  if (last < 2) return res({success: true, updated: 0});

  const col5 = sheet.getRange(2, 5, last - 1, 1).getValues();
  let count = 0;
  col5.forEach((row, i) => {
    if (row[0] === data.oldName) {
      col5[i][0] = data.newName;
      count++;
    }
  });
  if (count > 0) sheet.getRange(2, 5, last - 1, 1).setValues(col5);
  return res({success: true, updated: count});
}

function saveMasterData(data) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const key = data.key;
  const arr = data.data;

  if (key === 'shops') {
    const sheet = ss.getSheetByName('店マスタ');
    const last  = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, 2).clearContent();
    if (arr.length) sheet.getRange(2, 1, arr.length, 2).setValues(arr.map(s => [s.name, s.kokan]));
  }

  if (key === 'uchis') {
    const sheet = ss.getSheetByName('打ち手マスタ');
    const last  = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, 2).clearContent();
    if (arr.length) sheet.getRange(2, 1, arr.length, 2).setValues(arr.map(u => [u.name, u.type]));
  }

  if (key === 'kishus') {
    const sheet = ss.getSheetByName('機種一覧');
    const last  = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, 28).clearContent();

    if (arr.length) {
      const rows = arr.map(k => {
        const row = new Array(28).fill('');
        row[0]  = k.name;
        row[21] = k.heikin;
        row[22] = k.total;
        row[23] = k.total1R;
        row[24] = k.jikan;
        row[25] = k.hatsua;
        row[26] = k.heiren;
        row[27] = k.maker || '';

        (k.rounds || []).forEach((r, i) => {
          if (i < 10) {
            row[1 + i * 2] = r.balls;
            row[2 + i * 2] = parseInt(r.name, 10);
          }
        });
        return row;
      });
      sheet.getRange(2, 1, rows.length, 28).setValues(rows);
    }
  }

  return res({success: true});
}

function getRecords(params) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('稼働記録');
  const last  = sheet.getLastRow();
  if (last < 2) return {success: true, records: []};

  const raw     = sheet.getRange(2, 1, last - 1, 24).getValues();
  const rawDisp = sheet.getRange(2, 1, last - 1, 24).getDisplayValues();
  const records = [];

  raw.forEach((r, i) => {
    if (!r[0]) return;

    let jikanStr = rawDisp[i][6] || '—';
    if (jikanStr === '' || jikanStr === '0:00') jikanStr = '—';

    const d = new Date(r[0]);
    const dateStr = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');

    const toFloat = v => {
      if (!v && v !== 0) return '';
      const n = parseFloat(v);
      return isNaN(n) ? '' : parseFloat(n.toFixed(2));
    };

    records.push({
      row:          i + 2,
      date:         dateStr,
      shop:         r[1],
      kishu:        r[2],
      daiban:       r[3],
      uchi:         r[4],
      kosshi:       r[5],
      jikan:        jikanStr,
      kitaiJikyu:   r[7],
      shigoto:      r[8],
      shigotoJikyu: r[9],
      soKaiten:     r[10],
      kaitenRitsu:  toFloat(r[11]),
      border:       toFloat(r[12]),
      un:           r[13],
      sagitama:     r[14],
      hoshu:        r[15],
      soRounds:     r[16] !== '' ? parseInt(r[16], 10) : '',
      todayHits:    r[17] !== '' ? parseInt(r[17], 10) : '',
      hitBalls:     r[18] !== '' ? parseInt(r[18], 10) : '',
      jitsu1R:      toFloat(r[19]),
      kariHoshu:    r[20] !== '' ? parseInt(r[20], 10) : 0,
      mochiRatio:   r[21] !== '' ? parseFloat(r[21]) : 1,
      genkinInvest: r[22] !== '' ? parseInt(r[22], 10) : 0,
      koujo:        r[23] !== '' ? parseInt(r[23], 10) : 0
    });
  });

  records.reverse();
  return {success: true, records};
}

function getInit(params) {
  const masters = getMasters();
  const records = getRecords(params);
  return {
    success: true,
    shops: masters.shops,
    kishus: masters.kishus,
    uchis: masters.uchis,
    records: records.records
  };
}

function getMasters() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const shopSheet = ss.getSheetByName('店マスタ');
  const shopLast = shopSheet.getLastRow();
  const shops = shopLast >= 2
    ? shopSheet.getRange(2, 1, shopLast - 1, 2).getValues()
        .filter(r => r[0])
        .map(r => ({name: r[0], kokan: r[1]}))
    : [];

  const kishuSheet = ss.getSheetByName('機種一覧');
  const kishuLast = kishuSheet.getLastRow();
  const kishus = kishuLast >= 2
    ? kishuSheet.getRange(2, 1, kishuLast - 1, 28).getValues()
        .filter(r => r[0])
        .map(r => ({
          name:    r[0],
          maker:   r[27] || '',
          heikin:  r[21],
          total:   r[22],
          total1R: r[23],
          jikan:   r[24],
          hatsua:  r[25],
          heiren:  r[26],
          rounds:  buildRounds(r)
        }))
    : [];

  const uchiSheet = ss.getSheetByName('打ち手マスタ');
  const uchiLast = uchiSheet.getLastRow();
  const uchis = uchiLast >= 2
    ? uchiSheet.getRange(2, 1, uchiLast - 1, 2).getValues()
        .filter(r => r[0])
        .map(r => ({name: r[0], type: r[1]}))
    : [];

  return {success: true, shops, kishus, uchis};
}

function buildRounds(r) {
  const rounds = [];
  for (let i = 1; i <= 19; i += 2) {
    if (r[i] && r[i + 1]) {
      rounds.push({name: r[i + 1] + 'R', balls: r[i]});
    }
  }
  return rounds;
}

// =============================================
// 新報酬計算ロジック
// =============================================

function getKoujoRate(kitaiJikyu) {
  kitaiJikyu = Number(kitaiJikyu) || 0;
  if (kitaiJikyu <= 1500) {
    return 0.374;
  } else if (kitaiJikyu <= 1800) {
    return 0.374 - (0.374 - 0.15) * (kitaiJikyu - 1500) / 300;
  } else if (kitaiJikyu <= 2300) {
    return 0.15 - 0.15 * (kitaiJikyu - 1800) / 500;
  } else {
    return 0;
  }
}

function calcBaseReward(sagitama, kitaiJikyu) {
  sagitama = Number(sagitama) || 0;
  kitaiJikyu = Number(kitaiJikyu) || 0;
  const startLine = (kitaiJikyu >= 1800) ? 5000 : 10000;
  if (sagitama < startLine) return 0;
  return Math.floor(sagitama / 2500) * 2500;
}

function calcFinalReward(sagitama, kitaiJikyu100, genkinInvestYen, uchi) {
  sagitama = Number(sagitama) || 0;
  kitaiJikyu100 = Number(kitaiJikyu100) || 0;
  genkinInvestYen = Number(genkinInvestYen) || 0;

  if (uchi === '自分') {
    return { base: 0, koujo: 0, final: 0, rate: 0 };
  }

  const baseReward = calcBaseReward(sagitama, kitaiJikyu100);
  if (baseReward <= 0) {
    return { base: 0, koujo: 0, final: 0, rate: 0 };
  }

  const rate = getKoujoRate(kitaiJikyu100);
  const koujo = Math.round(genkinInvestYen * rate);
  const finalReward = Math.max(0, baseReward - koujo);

  return { base: baseReward, koujo: koujo, final: finalReward, rate: rate };
}

function toNumberSafe(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function buildMachineHourlyRateMap(ss) {
  const sheet = ss.getSheetByName('機種一覧');
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;

  const rows = sheet.getRange(2, 1, lastRow - 1, 25).getValues();
  rows.forEach(row => {
    const kishuName = row[0];
    const machineHourlyRate = toNumberSafe(row[24]);
    if (!kishuName) return;
    map[String(kishuName)] = machineHourlyRate;
  });
  return map;
}

function calcEffectiveKitaiWeight(soKaiten, machineHourlyRate) {
  const kaiten = toNumberSafe(soKaiten);
  const rate   = toNumberSafe(machineHourlyRate);
  if (kaiten <= 0 || rate <= 0) return 0;
  return kaiten / rate;
}

function calcRewardAvgKitai(sheet, date, uchi, currentKishu, currentSoKaiten, currentKitaiJikyu) {
  const ss = sheet.getParent();
  const machineHourlyRateMap = buildMachineHourlyRateMap(ss);

  let weightedSum = 0;
  let weightSum = 0;

  const currentRate = machineHourlyRateMap[String(currentKishu || '')];
  const currentWeight = calcEffectiveKitaiWeight(currentSoKaiten, currentRate);
  const currentKitai = toNumberSafe(currentKitaiJikyu);

  if (currentWeight > 0 && currentKitai > 0) {
    weightedSum += currentKitai * currentWeight;
    weightSum += currentWeight;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 23).getValues();
    const d2 = new Date(date).toDateString();

    rows.forEach(row => {
      if (!row[0]) return;
      const d1 = new Date(row[0]).toDateString();
      if (d1 !== d2 || row[4] !== uchi) return;

      const kishu = row[2];
      const soKaiten = row[10];
      const kitaiJikyu = row[7];
      const rate = machineHourlyRateMap[String(kishu || '')];
      const weight = calcEffectiveKitaiWeight(soKaiten, rate);
      const kitai = toNumberSafe(kitaiJikyu);

      if (weight > 0 && kitai > 0) {
        weightedSum += kitai * weight;
        weightSum += weight;
      }
    });
  }

  return weightSum > 0 ? (weightedSum / weightSum) : 0;
}

function calcHoshuDetail(sheet, date, uchi, currentKishu, currentSoKaiten, currentSagitama, kitaiJikyu, genkinInvest) {
  kitaiJikyu      = toNumberSafe(kitaiJikyu);
  currentSoKaiten = toNumberSafe(currentSoKaiten);
  currentSagitama = toNumberSafe(currentSagitama);
  genkinInvest    = toNumberSafe(genkinInvest);

  if (uchi === '自分') {
    return { base: 0, koujo: 0, final: 0, rate: 0, avgKitai: 0, ruikei: 0, ruikeiGenkin: 0 };
  }

  const lastRow = sheet.getLastRow();
  let ruikei = currentSagitama;
  let ruikeiGenkin = genkinInvest;

  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 23).getValues();
    const d2 = new Date(date).toDateString();

    rows.forEach(row => {
      if (!row[0]) return;
      const d1 = new Date(row[0]).toDateString();
      if (d1 === d2 && row[4] === uchi) {
        ruikei += toNumberSafe(row[14]);
        ruikeiGenkin += toNumberSafe(row[22]);
      }
    });
  }

  const avgKitai = calcRewardAvgKitai(
    sheet, date, uchi, currentKishu, currentSoKaiten, kitaiJikyu
  );

  const result = calcFinalReward(ruikei, avgKitai, ruikeiGenkin, uchi);

  return {
    base: result.base,
    koujo: result.koujo,
    final: result.final,
    rate: result.rate,
    avgKitai: avgKitai,
    ruikei: ruikei,
    ruikeiGenkin: ruikeiGenkin
  };
}

function calcHoshu(sheet, date, uchi, currentKishu, currentSoKaiten, currentSagitama, kitaiJikyu, genkinInvest) {
  return calcHoshuDetail(
    sheet, date, uchi, currentKishu, currentSoKaiten, currentSagitama, kitaiJikyu, genkinInvest
  ).final;
}

function timeToSerial(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) / 1440;
}

function testJikan() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('稼働記録');
  const r = sheet.getRange(2, 7).getValue();
  Logger.log(typeof r);
  Logger.log(r);
}

// =============================================
// 手動イベント管理
// =============================================

function getManualEvents() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('manual_events');
  if (!sheet) {
    sheet = ss.insertSheet('manual_events');
    sheet.getRange(1, 1, 1, 5).setValues([['date', 'store', 'event', 'source', 'created_at']]);
    return { success: true, events: [] };
  }
  const last = sheet.getLastRow();
  if (last < 2) return { success: true, events: [] };

  const rows = sheet.getRange(2, 1, last - 1, 5).getValues();
  const events = rows
    .filter(r => r[0])
    .map(r => {
      const d = new Date(r[0]);
      const dateStr = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      return {
        date:       dateStr,
        store:      r[1],
        event:      r[2],
        source:     r[3] || 'manual',
        created_at: r[4]
      };
    });
  return { success: true, events };
}

function addManualEvent(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('manual_events');
  if (!sheet) {
    sheet = ss.insertSheet('manual_events');
    sheet.getRange(1, 1, 1, 5).setValues([['date', 'store', 'event', 'source', 'created_at']]);
  }
  const now = new Date().toISOString();
  sheet.appendRow([data.date, data.store, data.event, 'manual', now]);
  return { success: true };
}

function deleteManualEvent(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('manual_events');
  if (!sheet) return { success: false, error: 'シートが存在しません' };

  const last = sheet.getLastRow();
  if (last < 2) return { success: false, error: 'データがありません' };

  const rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const d = new Date(rows[i][0]);
    const dateStr = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    if (dateStr === data.date && rows[i][1] === data.store && rows[i][2] === data.event) {
      sheet.deleteRow(i + 2);
      return { success: true };
    }
  }
  return { success: false, error: '対象レコードが見つかりません' };
}

// =============================================
// イベントメモ管理
// =============================================

function getEventNotes() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('event_notes');
  if (!sheet) {
    sheet = ss.insertSheet('event_notes');
    sheet.getRange(1, 1, 1, 3).setValues([['event_name', 'note', 'updated_at']]);
    return { success: true, notes: [] };
  }
  const last = sheet.getLastRow();
  if (last < 2) return { success: true, notes: [] };

  const rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  const notes = rows
    .filter(r => r[0])
    .map(r => ({ event_name: r[0], note: r[1], updated_at: r[2] }));
  return { success: true, notes };
}

function saveEventNote(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('event_notes');
  if (!sheet) {
    sheet = ss.insertSheet('event_notes');
    sheet.getRange(1, 1, 1, 3).setValues([['event_name', 'note', 'updated_at']]);
  }

  const now = new Date().toISOString();
  const last = sheet.getLastRow();

  if (last >= 2) {
    const rows = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === data.event_name) {
        sheet.getRange(i + 2, 2, 1, 2).setValues([[data.note, now]]);
        return { success: true, updated: true };
      }
    }
  }

  sheet.appendRow([data.event_name, data.note, now]);
  return { success: true, updated: false };
}

function res(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
// 既存コードへの接続方法は docs/AUTO_HOSHU_DEPLOY.md を参照。
const AutoHoshu = (() => {
  const START_KEY = 'autoHoshuStartDate_v1';
  const PREFIX = 'autoHoshuConfirmed_v1_';
  function today() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
  function startDate() { return PropertiesService.getScriptProperties().getProperty(START_KEY); }
  function key(date, uchi) { return PREFIX + encodeURIComponent(date) + '_' + encodeURIComponent(uchi); }
  function withLock(fn) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { return fn(); } finally { lock.releaseLock(); }
  }
  function isManaged(date) {
    const start = startDate();
    return !!start && String(date) >= start;
  }
  function snapshot() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('稼働記録');
    const last = sheet.getLastRow();
    const rows = last < 2 ? [] : sheet.getRange(2,1,last-1,24).getValues();
    const records = rows.map((r,i) => ({
      row:i+2,
      date:r[0] instanceof Date ? Utilities.formatDate(r[0],'Asia/Tokyo','yyyy-MM-dd') : String(r[0]).slice(0,10),
      uchi:String(r[4] || ''), kishu:String(r[2] || ''),
      sagitama:r[14],genkinInvest:r[22],kitaiJikyu:r[7],soKaiten:r[10],hoshu:r[15],
      shigoto:r[8],mochiRatio:r[21]
    })).filter(r => r.date && r.uchi && r.uchi !== '自分' && isManaged(r.date) && r.date < today());
    const kishus = getMasters().kishus;
    return {sheet,records,kishus};
  }
  function fingerprint(records,kishus) {
    const rates = buildMachineHourlyRateMap(kishus);
    const value = JSON.stringify(records.map(r => [r.row,r.date,r.uchi,r.kishu,r.sagitama,
      r.genkinInvest,r.kitaiJikyu,r.soKaiten,rates[r.kishu] || 0]));
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value));
  }
  function groupsFor(snap) {
    const props = PropertiesService.getScriptProperties();
    const dates = [...new Set(snap.records.map(r => r.date))];
    const groups = [];
    dates.forEach(date => {
      const people = [...new Set(snap.records.filter(r => r.date===date).map(r => r.uchi))];
      people.forEach(uchi => {
        const records = snap.records.filter(r => r.date===date && r.uchi===uchi);
        const hash = fingerprint(records,snap.kishus);
        const raw = props.getProperty(key(date,uchi));
        const saved = raw ? JSON.parse(raw) : null;
        const amountsMatch = saved && records.every(r => Number(r.hoshu || 0) === (r.row === saved.row ? saved.hoshu : 0));
        const status = saved ? (saved.hash===hash && amountsMatch ? 'confirmed' : 'changed') : 'pending';
        groups.push({date,uchi,records,hash,status});
      });
    });
    return groups;
  }
  function status() {
    return withLock(() => ({success:true,startDate:startDate(),groups:groupsFor(snapshot()).map(g =>
      ({date:g.date,uchi:g.uchi,status:g.status}))}));
  }
  function run(date, force) {
    return withLock(() => {
      if (!startDate()) throw new Error('自動確定の開始日が未設定です');
      if (force && (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !isManaged(date) || date >= today()))
        throw new Error('導入日以降、かつ昨日以前の日付を指定してください');
      const snap = snapshot();
      const processed=[],skipped=[],errors=[];
      groupsFor(snap).filter(g => !date || g.date===date).forEach(g => {
        if (!force && g.status !== 'pending') {
          skipped.push({date:g.date,uchi:g.uchi,reason:g.status}); return;
        }
        try {
          g.records.forEach(r => {
            if (!Number.isFinite(Number(r.sagitama)) || !Number.isFinite(Number(r.genkinInvest)))
              throw new Error('差玉または現金投資額が数値ではありません');
            r.sagitama = Number(r.sagitama); r.genkinInvest = Number(r.genkinInvest);
          });
          const result = buildHoshuConfirmRows(g.date,g.records,snap.kishus)[0];
          if (!result || !Number.isFinite(result.hoshu)) throw new Error('報酬を計算できません');
          // 管理開始日以降のこのグループだけを更新。途中行に報酬を残さない。
          g.records.forEach(r => snap.sheet.getRange(r.row,16).setValue(r.row===result.lastRow ? result.hoshu : 0));
          SpreadsheetApp.flush();
          PropertiesService.getScriptProperties().setProperty(key(g.date,g.uchi),JSON.stringify({
            hash:g.hash,row:result.lastRow,hoshu:result.hoshu,confirmedAt:new Date().toISOString()
          }));
          processed.push({date:g.date,uchi:g.uchi,row:result.lastRow,hoshu:result.hoshu});
        } catch(e) { errors.push({date:g.date,uchi:g.uchi,error:e.message}); }
      });
      return {success:errors.length===0,processed,skipped,errors,error:errors.length ? '一部の報酬を確定できませんでした' : undefined};
    });
  }
  function setup(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today() || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('開始日は明日以降を指定してください');
    return withLock(() => {
      const props=PropertiesService.getScriptProperties();
      const existing=props.getProperty(START_KEY);
      if (existing && existing!==date) throw new Error('開始日は設定済みです。変更しません');
      props.setProperty(START_KEY,date);
      const exists=ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction()==='runAutoConfirmHoshuDaily');
      if (!exists) ScriptApp.newTrigger('runAutoConfirmHoshuDaily').timeBased().atHour(0).nearMinute(30).everyDays(1).inTimezone('Asia/Tokyo').create();
    });
  }
function getKoujoRate(kitaiJikyu) {
  if (kitaiJikyu <= 1500) return 0.374;
  else if (kitaiJikyu <= 1800) return 0.374 - (0.374 - 0.15) * (kitaiJikyu - 1500) / 300;
  else if (kitaiJikyu <= 2300) return 0.15 - 0.15 * (kitaiJikyu - 1800) / 500;
  else return 0;
}

function calcFinalReward(sagitama, kitaiJikyu100, genkinInvestYen, uchi) {
  if (uchi === '自分') return { base: 0, koujo: 0, final: 0, rate: 0 };
  const startLine = (kitaiJikyu100 >= 1800) ? 5000 : 10000;
  if (sagitama < startLine) return { base: 0, koujo: 0, final: 0, rate: 0 };
  const baseReward = Math.floor(sagitama / 2500) * 2500;
  const rate = getKoujoRate(kitaiJikyu100);
  const koujo = Math.round((genkinInvestYen || 0) * rate);
  const finalReward = Math.max(0, baseReward - koujo);
  return { base: baseReward, koujo: koujo, final: finalReward, rate: rate };
}

function buildMachineHourlyRateMap(kishus) {
  const map = {};
  (kishus || []).forEach(k => {
    if (!k || !k.name) return;
    const rate = Number(k.jikan);
    map[k.name] = Number.isFinite(rate) && rate > 0 ? rate : 0;
  });
  return map;
}

function calcEffectiveKitaiWeight(soKaiten, machineHourlyRate) {
  const rot = Number(soKaiten);
  const rate = Number(machineHourlyRate);
  if (!Number.isFinite(rot) || !Number.isFinite(rate) || rot <= 0 || rate <= 0) return 0;
  return rot / rate;
}

function buildHoshuConfirmRows(targetDate, records, kishus) {
    const todayRecs = records.filter(r => r.date === targetDate);
    // 打ち手別に差玉・期待時給（加重平均）・現金投資を集計 ＆ 最後のセッション行番号を記録
    // 期待時給の加重平均：effectiveWeight = soKaiten / machineHourlyRate
    const machineRateMap = buildMachineHourlyRateMap(kishus || []);
    const byUchi = {};
    todayRecs.forEach(r => {
      const uchi = r.uchi || '自分';
      if (uchi === '自分') return; // 自分は報酬対象外
      if (!byUchi[uchi]) byUchi[uchi] = {
        sagitamaTotal: 0,
        kitaiJikyuWeightedSum: 0,  // 期待時給×effectiveWeight の合計
        kitaiJikyuWeightTotal: 0,  // effectiveWeight の合計（加重平均用）
        mochiRatioWeightedSum: 0,  // 持ち玉比率×仕事量の合計
        mochiRatioWeightTotal: 0,  // 仕事量の合計（持ち玉比率加重平均用）
        genkinInvestTotal: 0,
        lastRow: null,
        count: 0
      };
      byUchi[uchi].sagitamaTotal += (r.sagitama || 0);
      byUchi[uchi].genkinInvestTotal += (r.genkinInvest || 0);
      // 報酬用の累計期待時給（effectiveWeight = soKaiten / machineHourlyRate）
      if (r.kitaiJikyu != null && r.kitaiJikyu !== '') {
        const machineHourlyRate = machineRateMap[r.kishu] || Number(r.machineHourlyRate) || 0;
        const w = calcEffectiveKitaiWeight(r.soKaiten, machineHourlyRate);
        if (w > 0) {
          byUchi[uchi].kitaiJikyuWeightedSum += r.kitaiJikyu * w;
          byUchi[uchi].kitaiJikyuWeightTotal += w;
        }
      }
      // 持ち玉比率の仕事量加重平均（複数台合成用）
      if (r.mochiRatio != null && r.mochiRatio !== '') {
        const mw = Math.abs(r.shigoto || 0);
        byUchi[uchi].mochiRatioWeightedSum += r.mochiRatio * (mw > 0 ? mw : 1);
        byUchi[uchi].mochiRatioWeightTotal += mw > 0 ? mw : 1;
      }
      byUchi[uchi].count++;
      // row番号が大きい＝最後に入力された行
      if (byUchi[uchi].lastRow === null || r.row > byUchi[uchi].lastRow) {
        byUchi[uchi].lastRow = r.row;
      }
    });

    const entries = Object.entries(byUchi);
    // 確定報酬を計算（期待時給1800円以上→5千スタート、未満→1万スタート + 持ち玉控除）
    // 期待時給の判定は持ち玉100%ベースの effectiveWeight 加重平均を使用
    const newRows = entries.map(([uchi, d]) => {
      const avgKitaiJikyu = d.kitaiJikyuWeightTotal > 0
        ? d.kitaiJikyuWeightedSum / d.kitaiJikyuWeightTotal
        : 0;
      // 持ち玉比率の仕事量加重平均（複数台合成：shigoto加重）
      const weightedRatio = d.mochiRatioWeightTotal > 0
        ? d.mochiRatioWeightedSum / d.mochiRatioWeightTotal
        : 1;
      const reward = calcFinalReward(d.sagitamaTotal, avgKitaiJikyu, d.genkinInvestTotal, uchi);
      const startLine = (avgKitaiJikyu >= 1800) ? 5000 : 10000;
      const koujo = reward.koujo;
      return {
        id:          Date.now() + '_' + uchi,
        date:        targetDate,
        uchi,
        sagitamaTotal: d.sagitamaTotal,
        startLine,
        koujo,
        genkinInvest:  d.genkinInvestTotal,
        mochiRatio:    weightedRatio,          // 持ち玉比率（仕事量加重平均）
        hoshu:         reward.final,
        rate:          reward.rate,
        lastRow:       d.lastRow,
        count:         d.count,
        written:       false,
      };
    });

    return newRows;
}
  return {isManaged,withLock,status,run,setup};
})();
function runAutoConfirmHoshuDaily() {
  const result=AutoHoshu.run();
  console.log(JSON.stringify(result));
  if (!result.success) throw new Error(JSON.stringify(result.errors));
}
function setupAutoHoshu() {
  // 初回実行日の翌日（JST）から適用。既存の開始日は変更しない。
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('autoHoshuStartDate_v1');
  if (existing) {
    console.log('設定済みです。開始日: ' + existing);
    return;
  }
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');
  AutoHoshu.setup(tomorrow);
  console.log('設定完了。対象の稼働日: ' + tomorrow + '以降。初回確定はその翌日0:30頃です。');
}

// =============================================
// 合言葉（トークン）チェック
// =============================================
// リクエストの token を合言葉と単純な文字列一致で照合する。
// 合言葉はこの定数で管理する（GASのコードは非公開。GitHubの公開リポジトリには載せないこと）。
// スクリプトプロパティ APP_TOKEN を設定した場合はそちらを優先する（コードを変えずに変更したいとき用）。
const APP_TOKEN_DEFAULT = '';
function isAuthorizedToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN') || APP_TOKEN_DEFAULT;
  if (!expected) return false; // 空なら拒否
  return String(token) === expected;
}

// 既存 doPost / doGet は導入手順に従って Legacy 名へ変更する。
function doPost(e) {
  try {
    const data=JSON.parse(e.postData ? e.postData.contents : '{}');
    // 合言葉チェック（不一致・欠落は unauthorized を返して以降の処理を実行しない）
    if (!isAuthorizedToken(data.token)) return res({success:false, error:'unauthorized'});
    if (data.action==='reconfirmHoshu') return res(AutoHoshu.run(data.date,true));
    if (['addStockEntry','voidStockEntry','editStockEntry','transferStock'].includes(data.action)) return AutoHoshu.withLock(() => res(stockHandlePost(data)));
    return AutoHoshu.withLock(() => {
      if (data.action==='writeHoshu') {
        const row=Number(data.row);
        if (!Number.isInteger(row) || row<2) return res({success:false,error:'無効な行番号'});
        const sheet=SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('稼働記録');
        const raw=sheet.getRange(row,1).getValue();
        const date=raw instanceof Date ? Utilities.formatDate(raw,'Asia/Tokyo','yyyy-MM-dd') : String(raw);
        if (AutoHoshu.isManaged(date)) return res({success:false,error:'自動確定対象です。再計算・再確定を使用してください'});
      }
      return doPostLegacy(e);
    });
  } catch(error) { return res({success:false,error:error.message}); }
}
function doGet(e) {
  // 合言葉チェック（不一致・欠落は unauthorized を返して以降の処理を実行しない）
  if (!isAuthorizedToken(e.parameter.token)) return res({success:false, error:'unauthorized'});
  if (e.parameter.action==='stockLedger') return res(AutoHoshu.withLock(stockGetLedger));
  if (e.parameter.action==='stockBalances') return res(AutoHoshu.withLock(stockGetBalances));
  if (e.parameter.action==='hoshuStatus') {
    try { return res(AutoHoshu.status()); }
    catch(error) { return res({success:false,error:error.message}); }
  }
  return doGetLegacy(e);
}

// 貯玉台帳。書き込み処理は呼び出し元の AutoHoshu.withLock 内で実行する。
const STOCK_HEADERS = ['ID','登録日時','日付','店','カード','種別','増減玉','金額(円)','関連ID','メモ','状態','取消日時'];

function stockInteger(value, label, allowZero) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) throw new Error(label + 'は整数で入力してください');
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(number) || (!allowZero && number === 0)) {
    throw new Error(label + 'は整数で入力してください');
  }
  return number;
}

function stockText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(label + 'は1〜' + max + '文字で入力してください');
  }
  return value.trim();
}

// シートの数式解釈を防ぎ、読み出し時には入力どおりの文字列に戻す。
function stockSheetText(value) {
  return /^[=+\-@']/.test(value) ? "'" + value : value;
}

function stockDisplayText(value) {
  const text = String(value || '');
  return /^'[=+\-@']/.test(text) ? text.slice(1) : text;
}

function stockRedemptionBalls(amount, rate) {
  const yen = Number(amount);
  if (!Number.isSafeInteger(yen) || yen <= 0 || yen % 1000 !== 0) throw new Error('換金額は1000円単位で入力してください');
  const kokan = Number(rate);
  if (!Number.isFinite(kokan) || kokan <= 0) throw new Error('店の交換率が不正です');
  const balls = Math.round(yen * kokan / 100);
  if (!Number.isSafeInteger(balls)) throw new Error('換金玉数が大きすぎます。交換率を確認してください');
  return balls;
}

function stockBalancesFromRows(rows) {
  const balances = new Map();
  rows.forEach(row => {
    if (row.status !== '有効') return;
    const key = JSON.stringify([row.shop, row.card]);
    balances.set(key, (balances.get(key) || 0) + Number(row.balls));
  });
  return Array.from(balances, ([key, balance]) => {
    const [shop, card] = JSON.parse(key);
    return {shop, card, balance};
  }).sort((a, b) => a.shop.localeCompare(b.shop) || a.card.localeCompare(b.card));
}

function stockValidateEntry(input, shops) {
  if (!input || typeof input !== 'object') throw new Error('入力が不正です');
  const date = stockText(input.date, '日付', 10);
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('日付が不正です');
  const shop = stockText(input.shop, '店', 80);
  const master = shops.find(item => item.name === shop);
  if (!master) throw new Error('店マスタにない店です');
  const card = stockText(input.card, 'カード', 80);
  if (input.memo !== undefined && input.memo !== null && typeof input.memo !== 'string') throw new Error('メモは文字列で入力してください');
  const memo = input.memo === undefined || input.memo === null ? '' : input.memo.trim();
  if (memo.length > 500) throw new Error('メモは500文字以内にしてください');
  const type = stockText(input.type, '種別', 10);
  if (!['換金','棚卸し','手動'].includes(type) && !(input.allowWork && type === '稼働')) throw new Error('種別が不正です');
  let balls = 0;
  let amount = 0;
  if (type === '換金') {
    amount = stockInteger(input.amount, '換金額', false);
    balls = -stockRedemptionBalls(amount, master.kokan);
  } else if (type === '手動' || type === '稼働') {
    balls = stockInteger(input.balls, '玉数', false);
  } else {
    if (stockInteger(input.actualBalance, '実残高', true) < 0) throw new Error('実残高は0以上にしてください');
  }
  return {date, shop, card, type, balls, amount, memo};
}

function stockSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName('貯玉台帳');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('貯玉台帳');
    sheet.getRange(1, 1, 1, STOCK_HEADERS.length).setValues([STOCK_HEADERS]);
  }
  return sheet;
}

function stockReadRows(sheet) {
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return [];
  return sheet.getRange(2, 1, count, 12).getValues().map((row, index) => ({
    rowNumber:index + 2, id:String(row[0]), registeredAt:stockDateTime(row[1]), date:stockDate(row[2]),
    shop:String(row[3]), card:stockDisplayText(row[4]), type:String(row[5]), balls:Number(row[6]), amount:Number(row[7]) || 0,
    relatedId:String(row[8] || ''), memo:stockDisplayText(row[9]), status:String(row[10]), voidedAt:stockDateTime(row[11])
  })).filter(row => row.id);
}

function stockDate(value) {
  return value instanceof Date ? Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd') : String(value || '').slice(0, 10);
}

function stockDateTime(value) {
  return value instanceof Date ? Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss') : String(value || '');
}

function stockGetLedger() { return {success:true, rows:stockReadRows(stockSheet())}; }
function stockGetBalances() { return {success:true, balances:stockBalancesFromRows(stockReadRows(stockSheet()))}; }

function stockTransferEntries(data, shops) {
  const shop = stockText(data.shop, '店', 80);
  if (!shops.some(item => item.name === shop)) throw new Error('店マスタにない店です');
  const fromCard = stockText(data.fromCard, '移動元カード', 80);
  const toCard = stockText(data.toCard, '移動先カード', 80);
  if (fromCard === toCard) throw new Error('移動元と移動先は別のカードにしてください');
  const balls = stockInteger(data.balls, '玉数', false);
  if (balls < 0) throw new Error('移動玉数は正の整数にしてください');
  const base = {date:data.date, shop, type:'手動', memo:data.memo};
  const debit = stockValidateEntry({...base, card:fromCard, balls:-balls}, shops);
  const credit = stockValidateEntry({...base, card:toCard, balls}, shops);
  return [{...debit, type:'移動'}, {...credit, type:'移動'}];
}

function stockNewEntries(data, shops, rows, allowWork) {
  if (data.type === '移動' || data.action === 'transferStock') return stockTransferEntries(data, shops);
  const entry = stockValidateEntry({...data, allowWork}, shops);
  if (entry.type === '棚卸し') {
    const current = stockBalancesFromRows(rows).find(item => item.shop === entry.shop && item.card === entry.card);
    entry.balls = stockInteger(data.actualBalance, '実残高', true) - (current ? current.balance : 0);
  }
  return [entry];
}

function stockGroup(rows, id) {
  const target = rows.find(row => row.id === id);
  if (!target || target.status !== '有効') throw new Error('有効な台帳行が見つかりません');
  if (!target.relatedId) return [target];
  const group = rows.filter(row => row.relatedId === target.relatedId && row.status === '有効');
  if (group.length !== 2) throw new Error('移動の組が不完全です。台帳を確認してください');
  return group;
}

function stockAppendEntries(sheet, entries) {
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const relatedId = entries.length === 2 ? Utilities.getUuid() : '';
  const ids = entries.map(() => Utilities.getUuid());
  const values = entries.map((item, index) => [ids[index], now, item.date, item.shop, stockSheetText(item.card), item.type,
    item.balls, item.amount, relatedId, stockSheetText(item.memo), '有効', '']);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 12).setValues(values);
  return ids;
}

function stockVoidGroup(sheet, group) {
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const updated = [];
  try {
    group.forEach(row => {
      sheet.getRange(row.rowNumber, 11, 1, 2).setValues([['取消', now]]);
      updated.push(row);
    });
  } catch (error) {
    updated.forEach(row => sheet.getRange(row.rowNumber, 11, 1, 2).setValues([['有効', '']]));
    throw error;
  }
}

function stockHandlePost(data) {
  if (!['addStockEntry','voidStockEntry','editStockEntry','transferStock'].includes(data.action)) throw new Error('不明なアクション');
  const sheet = stockSheet();
  const rows = stockReadRows(sheet);
  if (data.action === 'voidStockEntry') {
    stockVoidGroup(sheet, stockGroup(rows, stockText(data.id, 'ID', 100)));
    return {success:true};
  }
  const shops = getMasters().shops;
  const oldGroup = data.action === 'editStockEntry' ? stockGroup(rows, stockText(data.id, 'ID', 100)) : [];
  const effectiveRows = rows.filter(row => !oldGroup.some(old => old.id === row.id));
  const allowWork = oldGroup.length === 1 && oldGroup[0].type === '稼働';
  const entries = stockNewEntries(data, shops, effectiveRows, allowWork);
  if (oldGroup.length && (oldGroup.length === 2) !== (entries.length === 2)) throw new Error('移動は移動として修正してください');
  if (oldGroup.length) stockVoidGroup(sheet, oldGroup);
  try {
    const ids = stockAppendEntries(sheet, entries);
    return {success:true, ids, entries};
  } catch (error) {
    oldGroup.forEach(row => sheet.getRange(row.rowNumber, 11, 1, 2).setValues([['有効', '']]));
    throw error;
  }
}
