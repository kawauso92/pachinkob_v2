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

  // 台帳の入力を稼働記録より先に検証する。
  const stockEntries = stockWorkEntries(data, stockReadRows(stockSheet()));
  sheet.appendRow(row);
  const newRow = sheet.getLastRow();

  sheet.getRange(newRow, 7).setNumberFormat('[h]:mm');
  sheet.getRange(newRow, 11).setNumberFormat('0');
  sheet.getRange(newRow, 12).setNumberFormat('0.00');
  sheet.getRange(newRow, 13).setNumberFormat('0.00');
  sheet.getRange(newRow, 14).setNumberFormat('0.0%');
  sheet.getRange(newRow, 22).setNumberFormat('0.0%');
  // 同一リクエスト・ロック内で台帳に追記し、失敗時は稼働記録を戻す。
  if (stockEntries.length) {
    try { stockAppendEntries(stockSheet(), stockEntries); }
    catch (error) { sheet.deleteRow(newRow); throw error; }
  }

  updateMachineSpeedsSafe();
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
      updateMachineSpeedsSafe();
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
    ? kishuSheet.getRange(2, 1, kishuLast - 1, Math.min(32, kishuSheet.getMaxColumns())).getValues()
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
          jisokuActual: r[28] || '', jisokuRot: r[29] || '', jisokuHours: r[30] || '', jisokuCount: r[31] || '',
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
  if (e.parameter.action==='getAutoEvents') {
    try { return res(getAutoEventsForApp()); }
    catch (error) { return res({success:false, error:error.message}); }
  }
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
    balls = stockInteger(input.balls, '玉数', type === '稼働');
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

function stockWorkEntry(data) {
  if (data.stockStart === '' || data.stockStart === null || data.stockStart === undefined || !data.stockCard) return null;
  if (typeof data.stockCard === 'string' && !data.stockCard.trim()) return null;
  const start = stockInteger(data.stockStart, '開始時貯玉', true);
  const endBlank = data.stockEnd === '' || data.stockEnd === null || data.stockEnd === undefined;
  const invest = endBlank && data.choTamaInvest !== '' && data.choTamaInvest !== null && data.choTamaInvest !== undefined
    ? stockInteger(data.choTamaInvest, '投資玉数', true) : 0;
  const end = endBlank ? start - invest : stockInteger(data.stockEnd, '投資終了時貯玉', true);
  const recover = data.stockRecoverRaw === '' || data.stockRecoverRaw === null || data.stockRecoverRaw === undefined
    ? 0 : stockInteger(data.stockRecoverRaw, '回収玉数', true);
  if (start < 0 || (!endBlank && end < 0) || invest < 0 || recover < 0) throw new Error('貯玉・回収玉数は0以上にしてください');
  const balls = end + recover - start;
  if (!Number.isSafeInteger(balls)) throw new Error('貯玉の増減が大きすぎます');
  // 稼働側の自由メモが長くても既存の送信を妨げない。
  const memo = typeof data.memo === 'string' ? data.memo.slice(0, 500) : '';
  return stockValidateEntry({date:data.date, shop:data.shop, card:data.stockCard, type:'稼働',
    balls, memo, allowWork:true}, getMasters().shops);
}

// 初回残高と今回の増減を、同じロック内でまとめて登録する。
function stockWorkEntries(data, rows) {
  const hasStockFields = ['stockStart','stockCard','stockEnd','stockRecoverRaw']
    .some(key => data[key] !== undefined);
  if (!hasStockFields) return [];
  if (data.stockStart === '' || data.stockStart === null || data.stockStart === undefined) {
    throw new Error('開始時貯玉を入力してください');
  }
  stockText(data.stockCard, '貯玉カード', 80);
  const entry = stockWorkEntry(data);
  const current = stockBalancesFromRows(rows).find(item => item.shop === entry.shop && item.card === entry.card);
  const start = stockInteger(data.stockStart, '開始時貯玉', true);
  if (current) {
    if (current.balance < 0) throw new Error('台帳残高がマイナスです。AppBの棚卸しで実残高に補正してください');
    if (start !== current.balance) throw new Error('開始時貯玉が台帳残高と異なります。入力を直すか、AppBの棚卸しで補正してください');
    return [entry];
  }
  if (start === 0) return [entry];
  return [{...entry, type:'手動', balls:start, memo:'開始時貯玉から初回残高を登録'}, entry];
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
  const relatedId = entries.length === 2 && entries.every(item => item.type === '移動') ? Utilities.getUuid() : '';
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
var EVENT_SOURCE_SLOPACHI = 'スロパチ公式';
// スロパチ公式: 中継（api/slopachi.js）で取る4ページ
var SLOPACHI_ORIGIN = 'https://777.slopachi-station.com';
var SLOPACHI_PAGE_PATHS = {
  kansai: '/report_schedule/kansai/',
  renjiro: '/renjiro_schedule/',
  janjan: '/janjan_schedule/',
  ruibee: '/ruibee_schedule/'
};
var PACHISURO100_URL = 'https://pachisuro100.com/osaka-schedule/';
var JANBARI_URL = 'https://jb-portal.com/schedule/?report_id=4';
var TAMADOJO_URL = 'https://tama-dojo.com/';
var OSAKA_TEXT = '大阪';
var JANBARI_EVENT_NAME = 'ジャンバリ潜入来店取材';

// パチンコ寄りと確認済みのスロパチ演者（2026-10-30 持ち主確認）
var SLOPACHI_PACHINKO_ACTORS = ['れんじろう', 'じゃんじゃん', 'るいべえ'];

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

  // 0. スロパチの演者（パチンコ寄りと持ち主が確認済み）→ P
  //    「じゃんじゃん実践来店(青)」のように色が付いていても、演者を優先する。
  for (var i = 0; i < SLOPACHI_PACHINKO_ACTORS.length; i++) {
    if (name.indexOf(SLOPACHI_PACHINKO_ACTORS[i]) >= 0) return 'P';
  }

  // 1. ひらがなの「すろぱち」はパチンコ枠。
  //    「すろぱちアワード景品入荷(黒)」をP/S判定に使う（カタカナの「スロぱちガールPS」は対象外）。
  if (name.indexOf('すろぱち') >= 0) return 'P';

  // 2. 取材名に「PS」→ PS（「PS」はパチスロ寄り）
  if (name.indexOf('PS') >= 0) return 'PS';

  // 3. 取材名に「玉」「(P)」→ P
  if (name.indexOf('玉') >= 0 || name.indexOf('(P)') >= 0 || name.indexOf('（P）') >= 0) return 'P';

  // 4. 媒体がスロパチステーションの色付き取材
  //    (黒)・(オレンジ) → P / (青) → PS
  if (medium.indexOf('スロパチステーション') >= 0) {
    if (name.indexOf('(黒)') >= 0 || name.indexOf('（黒）') >= 0) return 'P';
    if (name.indexOf('(オレンジ)') >= 0 || name.indexOf('（オレンジ）') >= 0) return 'P';
    if (name.indexOf('(青)') >= 0 || name.indexOf('（青）') >= 0) return 'PS';
  }

  // 5. パチスロ100の補足に「パチンコ」→ P（「パチスロ」も含めば PS）
  if (memo.indexOf('パチンコ') >= 0) {
    return memo.indexOf('パチスロ') >= 0 ? 'PS' : 'P';
  }

  // 6. 末尾「来店S」→ S
  if (/来店S\s*$/.test(name)) return 'S';

  // 7. それ以外 → S
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
    } else if (label) {
      kinds.push(label);
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
    // 日付見出しの下に「都道府県 / 店名 / 取材名」が続く。
    // 同じ日付に複数店舗が並ぶことがあるため、日付は保持したまま3行ずつ読む。
    var currentDate = null;
    for (var index = 0; index < lines.length; index++) {
      var date = parseJpDate(lines[index], referenceDate);
      if (date) {
        currentDate = date;
        continue;
      }
      if (!currentDate || lines[index] !== OSAKA_TEXT) continue;
      if (index + 2 >= lines.length) break;
      var store = lines[index + 1];
      var eventText = lines[index + 2];
      if (eventText !== JANBARI_EVENT_NAME || !store) continue;
      out.push(evMakeRecord(currentDate, store, OSAKA_TEXT, '取材', JANBARI_EVENT_NAME, '', '',
        EVENT_SOURCE_JANBARI, JANBARI_URL));
      index += 2;
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
      var firstVisit = lines[index + 1] === '初取材';
      if (firstVisit && index + 3 >= lines.length) continue;
      var eventType = lines[index + (firstVisit ? 2 : 1)];
      var store = lines[index + (firstVisit ? 3 : 2)];
      var eventName = TAMADOJO_EVENT_NAME_BY_TYPE[eventType];
      if (!eventName || !store || TAMADOJO_EVENT_NAME_BY_TYPE[store]) continue;
      out.push(evMakeRecord(currentDate, store, OSAKA_TEXT, '取材', eventName, '', firstVisit ? '初取材' : '',
        EVENT_SOURCE_TAMADOJO, TAMADOJO_URL));
    }
  } catch (e) {
    return out;
  }
  return out;
}

// =============================================
// スロパチ公式（JSON-LD の Event と画面カードを対応づける）
// =============================================
// カードの形（2026-10-30 の fixture）:
//   <div class="resultRow resultRow-tile">
//     <div class="resultRow-image"><img src="...-red.png" alt="来店取材赤"></div>
//     <div class="resultRow-box"><div class="resultRow-detail">
//       10/31 (...) 【大阪府大阪市淀川区】<br>
//       <a href="...">スロパチステーション来店取材 マルハン加島店</a>
//     </div></div>
//   </div>
// JSON-LD の Event は name に色を持たないので、日付・店名・取材名が一致する
// カードを探し、画像の alt（無ければ src の red/blue/...）から色を取る。
function slopachiNorm(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, '');
}

// 店名の表記ゆれ（MEGAFACE→MEGAフェイス、末尾の「店」、記号、空白）を吸収する
function slopachiKeyText(value) {
  return slopachiNorm(value).replace(/megaface/g, 'megaフェイス').replace(/[・･.,，、]/g, '');
}

function slopachiStoreKey(value) {
  var key = slopachiKeyText(value);
  if (key.length > 1 && key.charAt(key.length - 1) === '店') key = key.slice(0, -1);
  return key;
}

function slopachiColorFromText(value) {
  var text = evCleanText(value);
  var m = /[（(](赤|青|紫|黄|黒|オレンジ)[）)]/.exec(text);
  if (m) return m[1];
  m = /来店取材(赤|青|紫|黄|黒|オレンジ)\s*$/.exec(text);
  return m ? m[1] : '';
}

var SLOPACHI_COLOR_BY_FILE = {
  red: '赤', blue: '青', purple: '紫', yellow: '黄', orange: 'オレンジ', black: '黒'
};

function slopachiCardColor(card) {
  var color = slopachiColorFromText(card.alt);
  if (color) return color;
  var file = String(card.src || '').split('/').pop();
  var m = /(red|blue|purple|yellow|orange|black)(?:\.|$)/i.exec(file);
  return m ? SLOPACHI_COLOR_BY_FILE[m[1].toLowerCase()] : '';
}

function slopachiCards(html) {
  var cards = [];
  var parts = String(html === null || html === undefined ? '' : html).split('<div class="resultRow resultRow-tile');
  for (var i = 1; i < parts.length; i++) {
    var chunk = parts[i];
    var next = chunk.indexOf('<div class="resultRow resultRow-tile');
    if (next >= 0) chunk = chunk.slice(0, next);
    var img = /<img\b[^>]*>/i.exec(chunk);
    var date = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(evStripTags(chunk));
    var area = /【([^】]+)】/.exec(chunk);
    var anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    if (!img || !date || !area || !anchor) continue;
    var alt = /alt="([^"]*)"/i.exec(img[0]);
    var src = /src="([^"]*)"/i.exec(img[0]);
    cards.push({
      month: parseInt(date[1], 10), day: parseInt(date[2], 10),
      area: evCleanText(area[1]), text: evHtmlToText(anchor[1]),
      alt: alt ? alt[1] : '', src: src ? src[1] : ''
    });
  }
  return cards;
}

// 日付・店名・取材名が一致するカードを1枚だけ使う（同じカードを2回使わない）
function slopachiFindCard(cards, used, date, store, eventName) {
  var month = parseInt(date.slice(5, 7), 10);
  var day = parseInt(date.slice(8, 10), 10);
  var storeKey = slopachiStoreKey(store);
  var eventKeyText = slopachiNorm(eventName);
  var sameStore = [];
  for (var i = 0; i < cards.length; i++) {
    if (used[i]) continue;
    var card = cards[i];
    if (card.month !== month || card.day !== day) continue;
    var text = slopachiKeyText(card.text);
    if (storeKey && text.indexOf(storeKey) < 0) continue;
    sameStore.push(i);
    if (eventKeyText && text.indexOf(eventKeyText) >= 0) {
      used[i] = true;
      return card;
    }
  }
  // 取材名が一致するカードが無いときは、同じ日・同じ店のカードが1枚だけのときに限り使う。
  // 2枚以上あるなら、別の取材の色を付けないように色なしにする。
  if (sameStore.length === 1) {
    used[sameStore[0]] = true;
    return cards[sameStore[0]];
  }
  return null;
}

// パチスロ100の表記に合わせる（景品入荷→アワード景品入荷、色は末尾の括弧）
function slopachiDisplayName(baseName, color) {
  var name = evCleanText(baseName);
  if (name === 'スロパチ景品入荷' || name === 'すろぱち景品入荷') {
    name = name.replace('景品入荷', 'アワード景品入荷');
  }
  if (color && !/[（(](赤|青|紫|黄|黒|オレンジ)[）)]\s*$/.test(name)) {
    name += '(' + color + ')';
  }
  return name;
}

function parseSlopachiJsonLd(html, url) {
  var out = [];
  var source = String(html === null || html === undefined ? '' : html);
  var cards = slopachiCards(source);
  var used = {};
  var re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  var m;
  while ((m = re.exec(source)) !== null) {
    var data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    var items = Array.isArray(data) ? data : (data && Array.isArray(data['@graph']) ? data['@graph'] : [data]);
    for (var i = 0; i < items.length; i++) {
      var x = items[i];
      if (!x || x['@type'] !== 'Event') continue;
      var place = x.location || {};
      var address = place.address || {};
      if (address.addressRegion !== '大阪府') continue;
      var date = String(x.startDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      var store = evCleanText(place.name);
      var event = evCleanText(x.name);
      if (!store || !event) continue;
      // 「(予定)」は取材名ではなく補足に回す（色の括弧と混ざらないように）
      var pending = /[（(]予定[）)]\s*$/.test(event);
      var baseEvent = event.replace(/\s*[（(]予定[）)]\s*$/, '');
      var card = slopachiFindCard(cards, used, date, store, baseEvent);
      var display = slopachiDisplayName(baseEvent, card ? slopachiCardColor(card) : '');
      out.push(evMakeRecord(date, store, evCleanText(address.addressLocality) || OSAKA_TEXT, '来店', display,
        'スロパチステーション', pending ? '予定' : '', EVENT_SOURCE_SLOPACHI, url));
    }
  }
  return out;
}

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

// 機種一覧の AC〜AF 列に、稼働記録から出した実測の時速を書く。
// 集計値なので、記録の送信時と機種マスタの保存時に全機種分を作り直す（行の並び替え・削除でずれないように）。
const MACHINE_SPEED_COL = 29; // AC列
const MACHINE_SPEED_HEADERS = ['実測時速', '通常回転合計', '稼働時間合計', '回数'];

// 稼働記録の稼働時間（"h:mm"）を時間に直す。読めなければ null
function machineSpeedHours(text) {
  const m = /^(\d+):(\d{1,2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  return h > 0 ? h : null;
}

// rows: [[機種名, 稼働時間の表示文字列, 通常回転], ...] → {機種名: {speed, rot, hours, count}}
// 時間か回転が無い記録は除く。時速は「通常回転の合計 ÷ 稼働時間の合計」
function machineSpeedStats(rows) {
  const stats = {};
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const name = String((r && r[0]) || '').trim();
    const hours = machineSpeedHours(r && r[1]);
    const rot = Number(r && r[2]);
    if (!name || !(hours > 0) || !(rot > 0)) return;
    const s = stats[name] || (stats[name] = {rot: 0, hours: 0, count: 0});
    s.rot += rot; s.hours += hours; s.count++;
  });
  Object.keys(stats).forEach(name => { stats[name].speed = stats[name].rot / stats[name].hours; });
  return stats;
}

// 機種一覧の各行に書く4列（記録が無い機種は空欄）
function machineSpeedRow(stat) {
  if (!stat) return ['', '', '', ''];
  return [Math.round(stat.speed * 10) / 10, Math.round(stat.rot), Math.round(stat.hours * 100) / 100, stat.count];
}

function updateMachineSpeeds() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const rec = ss.getSheetByName('稼働記録');
  const ks = ss.getSheetByName('機種一覧');
  if (!rec || !ks) return;
  const recLast = rec.getLastRow();
  const rows = [];
  if (recLast >= 2) {
    const kishu = rec.getRange(2, 3, recLast - 1, 1).getValues();
    const jikan = rec.getRange(2, 7, recLast - 1, 1).getDisplayValues();
    const kaiten = rec.getRange(2, 11, recLast - 1, 1).getValues();
    for (let i = 0; i < kishu.length; i++) rows.push([kishu[i][0], jikan[i][0], kaiten[i][0]]);
  }
  const stats = machineSpeedStats(rows);
  const need = MACHINE_SPEED_COL + MACHINE_SPEED_HEADERS.length - 1;
  if (ks.getMaxColumns() < need) ks.insertColumnsAfter(ks.getMaxColumns(), need - ks.getMaxColumns());
  ks.getRange(1, MACHINE_SPEED_COL, 1, MACHINE_SPEED_HEADERS.length).setValues([MACHINE_SPEED_HEADERS]);
  const ksLast = ks.getLastRow();
  if (ksLast < 2) return;
  const names = ks.getRange(2, 1, ksLast - 1, 1).getValues();
  const values = names.map(r => machineSpeedRow(stats[String(r[0] || '').trim()]));
  ks.getRange(2, MACHINE_SPEED_COL, values.length, MACHINE_SPEED_HEADERS.length).setValues(values);
}

// 送信・保存の本処理を止めないように、失敗しても例外を外へ出さない
function updateMachineSpeedsSafe() {
  try { updateMachineSpeeds(); } catch (e) { console.warn('実測時速の更新に失敗: ' + e.message); }
}

