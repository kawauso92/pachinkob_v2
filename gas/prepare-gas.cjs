// node gas/prepare-gas.cjs <既存GASソース> <出力ファイル>
// 元ファイルは変更せず、AutoHoshu.gsを含む反映用コードを生成する。
const fs=require('fs'),path=require('path');
const [input,output]=process.argv.slice(2);
if(!input||!output||path.resolve(input)===path.resolve(output)) throw new Error('異なる入力・出力ファイルを指定してください');
let source=fs.readFileSync(input,'utf8');
for(const [pattern,replacement] of [
 [/function doPost\(e\)/g,'function doPostLegacy(e)'],
 [/function doGet\(e\)/g,'function doGetLegacy(e)'],
 [/const hoshu = hoshuDetail\.final;/g,'const hoshu = AutoHoshu.isManaged(data.date) ? 0 : hoshuDetail.final;']
]){
 if((source.match(pattern)||[]).length!==1) throw new Error('既存ソースが想定と異なります: '+pattern);
 source=source.replace(pattern,replacement);
}
source+='\n'+fs.readFileSync(path.join(__dirname,'AutoHoshu.gs'),'utf8');
fs.writeFileSync(output,source,{encoding:'utf8',flag:'wx'});
console.log('反映用コードを作成しました。開始日を設定し、GASのバックアップ後に反映してください。');
