// 合言葉版を変更せず、貯玉台帳を接続した全文置き換え用コードを生成する。
const fs = require('node:fs');
const path = require('node:path');

const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) throw new Error('別の入力・出力ファイルを指定してください');
let source = fs.readFileSync(input, 'utf8');
const ledger = fs.readFileSync(path.join(__dirname, 'StockLedger.gs'), 'utf8');
const sanitize = process.argv.includes('--sanitize');
if (sanitize) {
  const tokenPattern = /const APP_TOKEN_DEFAULT = [^;\r\n]*;/g;
  if ((source.match(tokenPattern) || []).length !== 1) throw new Error('合言葉定数が見つかりません');
  source = source.replace(tokenPattern, "const APP_TOKEN_DEFAULT = '';");
  const idPattern = /const SPREADSHEET_ID = [^;\r\n]*;/g;
  if ((source.match(idPattern) || []).length !== 1) throw new Error('スプレッドシートID定数が見つかりません');
  source = source.replace(idPattern,
    "// 公開リポジトリのためIDは載せない。GASに貼り付けた後、実際のスプレッドシートIDに置き換える。\nconst SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';");
}

function replaceOnce(pattern, replacement) {
  const matches = source.match(pattern) || [];
  if (matches.length !== 1) throw new Error('GASの接続点が想定と異なります');
  source = source.replace(pattern, replacement);
}

replaceOnce(
  /if \(data\.action==='reconfirmHoshu'\) return res\(AutoHoshu\.run\(data\.date,true\)\);/g,
  "if (data.action==='reconfirmHoshu') return res(AutoHoshu.run(data.date,true));\n    if (['addStockEntry','voidStockEntry','editStockEntry','transferStock'].includes(data.action)) return AutoHoshu.withLock(() => res(stockHandlePost(data)));"
);
replaceOnce(
  /if \(e\.parameter\.action==='hoshuStatus'\) \{/g,
  "if (e.parameter.action==='stockLedger') return res(AutoHoshu.withLock(stockGetLedger));\n  if (e.parameter.action==='stockBalances') return res(AutoHoshu.withLock(stockGetBalances));\n  if (e.parameter.action==='hoshuStatus') {"
);
fs.writeFileSync(output, source + '\n' + ledger, {encoding:'utf8', flag:sanitize || process.argv.includes('--replace') ? 'w' : 'wx'});
console.log('貯玉台帳を接続したGASファイルを作成しました');
