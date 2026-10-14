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
