// 本番稼働中の貯玉連携版を変更せず、イベント機能を接続したGAS全文を生成する。
const fs = require('node:fs');
const path = require('node:path');

const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) throw new Error('別の入力・出力ファイルを指定してください');
let source = fs.readFileSync(input, 'utf8');
const parser = fs.readFileSync(path.join(__dirname, 'EventParsers.gs'), 'utf8');
const collector = fs.readFileSync(path.join(__dirname, 'EventCollector.gs'), 'utf8');
const machineSpeed = fs.readFileSync(path.join(__dirname, 'MachineSpeed.gs'), 'utf8');

// 接続点がちょうど1か所あることを確かめてから置き換える
function wireOnce(pattern, replacement, label) {
  const matches = source.match(pattern) || [];
  if (matches.length !== 1) throw new Error(label + 'の接続点が想定と異なります');
  source = source.replace(pattern, replacement);
}
// 実測時速：機種一覧の AC〜AF 列を読んで返す（列が足りない古いシートでも落ちないように）
wireOnce(/kishuSheet\.getRange\(2, 1, kishuLast - 1, 28\)\.getValues\(\)/g,
  "kishuSheet.getRange(2, 1, kishuLast - 1, Math.min(32, kishuSheet.getMaxColumns())).getValues()", '機種一覧の読み込み');
wireOnce(/          heiren:  r\[26\],\r?\n/g,
  "          heiren:  r[26],\n          jisokuActual: r[28] || '', jisokuRot: r[29] || '', jisokuHours: r[30] || '', jisokuCount: r[31] || '',\n", '機種の項目');
// 実測時速：機種マスタの保存後と、記録の送信後に作り直す
wireOnce(/      sheet\.getRange\(2, 1, rows\.length, 28\)\.setValues\(rows\);\r?\n/g,
  "      sheet.getRange(2, 1, rows.length, 28).setValues(rows);\n      updateMachineSpeedsSafe();\n", '機種マスタの保存');
wireOnce(/  return res\(\{\r?\n    success: true,\r?\n    row: newRow,/g,
  "  updateMachineSpeedsSafe();\n  return res({\n    success: true,\n    row: newRow,", '記録の送信');

const route = /if \(e\.parameter\.action==='stockBalances'\) return res\(AutoHoshu\.withLock\(stockGetBalances\)\);/g;
if ((source.match(route) || []).length !== 1) throw new Error('GASのGET接続点が想定と異なります');
source = source.replace(route,
  "if (e.parameter.action==='stockBalances') return res(AutoHoshu.withLock(stockGetBalances));\n" +
  "  if (e.parameter.action==='getAutoEvents') {\n" +
  "    try { return res(getAutoEventsForApp()); }\n" +
  "    catch (error) { return res({success:false, error:error.message}); }\n" +
  "  }");

if (process.argv.includes('--sanitize')) {
  const tokenPattern = /const APP_TOKEN_DEFAULT = [^;\r\n]*;/g;
  const idPattern = /const SPREADSHEET_ID = [^;\r\n]*;/g;
  if ((source.match(tokenPattern) || []).length !== 1 || (source.match(idPattern) || []).length !== 1) {
    throw new Error('合言葉またはIDの定数が想定と異なります');
  }
  source = source.replace(tokenPattern, "const APP_TOKEN_DEFAULT = '';");
  source = source.replace(idPattern,
    "// 公開リポジトリのためIDは載せない。GASに貼り付けた後、実際のスプレッドシートIDに置き換える。\nconst SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';");
}

const outputText = source + '\n' + parser + '\n' + collector + '\n' + machineSpeed + '\n';
const replace = process.argv.includes('--replace') || process.argv.includes('--sanitize');
fs.writeFileSync(output, outputText, {encoding:'utf8', mode:0o600, flag:replace ? 'w' : 'wx'});
if (!process.argv.includes('--sanitize')) fs.chmodSync(output, 0o600);
console.log('イベント収集を接続したGASファイルを作成しました');
