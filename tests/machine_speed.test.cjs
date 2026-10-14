// 機種一覧に書く実測時速（GAS: gas/MachineSpeed.gs）と、全文への組み込みのテスト
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/MachineSpeed.gs'), 'utf8'), context);
const call = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, context)));

assert.equal(call('machineSpeedHours("2:30")'), 2.5);
assert.equal(call('machineSpeedHours("0:00")'), null);
assert.equal(call('machineSpeedHours("")'), null);
context.rows = [
  ['大海5', '4:00', 900],
  ['大海5', '2:00', 420],
  ['大海5', '—', 300],      // 時間なしは除く
  ['大海5', '1:00', ''],    // 回転なしは除く
  ['リゼロ', '3:00', 600],
  ['', '1:00', 100],        // 機種名なしは除く
];
const stats = call('machineSpeedStats(rows)');
assert.deepEqual(Object.keys(stats).sort(), ['リゼロ', '大海5']);
assert.deepEqual(stats['大海5'], {rot: 1320, hours: 6, count: 2, speed: 220});
assert.deepEqual(call('machineSpeedRow(machineSpeedStats(rows)["大海5"])'), [220, 1320, 6, 2]);
assert.deepEqual(call('machineSpeedRow(undefined)'), ['', '', '', '']);

// 公開用の全文に、読み込み・保存後・送信後の更新が1か所ずつ入っている
const pub = fs.readFileSync(path.join(__dirname, '../gas/Code.events.paste-ready.gs'), 'utf8');
assert.ok(pub.includes('Math.min(32, kishuSheet.getMaxColumns())'));
assert.ok(pub.includes("jisokuActual: r[28] || ''"));
assert.equal((pub.match(/updateMachineSpeedsSafe\(\);/g) || []).length, 2);
assert.ok(pub.includes('function updateMachineSpeeds()'));
console.log('PASS: 実測時速の集計（機種一覧 AC〜AF）と全文への組み込み');
