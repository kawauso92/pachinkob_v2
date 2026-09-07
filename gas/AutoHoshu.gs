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
  // 反映時に明日以降の開始日に変更してから、1回だけ実行してください。
  AutoHoshu.setup('YYYY-MM-DD');
}

// 既存 doPost / doGet は導入手順に従って Legacy 名へ変更する。
function doPost(e) {
  try {
    const data=JSON.parse(e.postData ? e.postData.contents : '{}');
    if (data.action==='reconfirmHoshu') return res(AutoHoshu.run(data.date,true));
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
  if (e.parameter.action==='hoshuStatus') {
    try { return res(AutoHoshu.status()); }
    catch(error) { return res({success:false,error:error.message}); }
  }
  return doGetLegacy(e);
}
