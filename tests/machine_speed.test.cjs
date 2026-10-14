// 実測時速（通常回転の合計 ÷ 稼働時間の合計）のテスト
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = '// ==== 実測時速の純関数（ここから）';
const end = '// ==== 実測時速の純関数（ここまで）';
assert.ok(html.includes(start) && html.includes(end));
const code = html.slice(html.indexOf(start), html.indexOf(end));
const {parseKadoHours, calcMachineSpeed} = new Function(`${code}\nreturn {parseKadoHours, calcMachineSpeed};`)();

assert.equal(parseKadoHours('2:30'), 2.5);
assert.equal(parseKadoHours('0:00'), null);
assert.equal(parseKadoHours('—'), null);
assert.equal(parseKadoHours(''), null);
const recs = [
  {kishu:'大海5', jikan:'4:00', soKaiten:900},
  {kishu:'大海5', jikan:'2:00', soKaiten:420},
  {kishu:'大海5', jikan:'—', soKaiten:300},     // 時間なしは除く
  {kishu:'大海5', jikan:'1:00', soKaiten:''},   // 回転なしは除く
  {kishu:'リゼロ', jikan:'3:00', soKaiten:600},
];
const sp = calcMachineSpeed(recs, '大海5');
assert.equal(sp.count, 2);
assert.equal(sp.rot, 1320);
assert.equal(sp.hours, 6);
assert.equal(sp.speed, 220);
assert.equal(calcMachineSpeed(recs, '無い機種'), null);
assert.equal(calcMachineSpeed(null, '大海5'), null);
console.log('PASS: 実測時速の集計（時間・回転の無い記録を除く）');
