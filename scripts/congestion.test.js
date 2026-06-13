// Node 単体テスト:  node scripts/congestion.test.js
'use strict';
const C = require('./congestion');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`); }
}

const START = '8時40分頃の #事故 により、岡山方面行 #加古川バイパス #加古川東(69.3kp)付近、車線規制を行っています。\n渋滞情報は(url）をご確認下さい。\n#姫路バイパス ＃渋滞';
const CLEAR_RESIDUAL = '岡山方面行 加古川バイパス #加古川東(69.3kp)付近 8時40分頃の#事故 の処理終了 渋滞残あり\n渋滞情報は(url)をご確認下さい ＃渋滞';
const CLEAR_CLEAN = '岡山方面行 加古川バイパス #加古川東(69.3kp)付近 8時40分頃の#事故 の処理終了\n渋滞情報は(url)をご確認下さい ＃渋滞';
const WORK = '【6月13日 昼間の工事規制予定】 国道2号:車線規制を伴う工事予定なし 国道29号:車線規制を伴う工事予定なし';

// mentionsCongestion
eq('congestion: 渋滞残あり', C.mentionsCongestion(CLEAR_RESIDUAL), true);
eq('congestion: 定型文のみ false', C.mentionsCongestion(START), false);
eq('congestion: 渋滞解消 false', C.mentionsCongestion('渋滞は解消しました ＃渋滞'), false);

// isClearance
eq('clearance: 処理終了', C.isClearance(CLEAR_CLEAN), true);
eq('clearance: 発生は false', C.isClearance(START), false);

const NOW = new Date('2026-06-13T01:00:00+09:00').getTime();
const tA = (txt, iso) => ({ text: txt, created_at: iso });

// 1) 発生中の事故 → 渋滞(alert)
eq('eval: 事故発生中=congested',
  C.evaluate([tA(START, '2026-06-13T00:40:00+09:00')], NOW).congested, true);

// 2) 処理終了 渋滞残あり(期限内) → 渋滞継続
eq('eval: 処理終了+渋滞残=congested',
  C.evaluate([
    tA(START, '2026-06-12T23:40:00+09:00'),
    tA(CLEAR_RESIDUAL, '2026-06-13T00:30:00+09:00'),
  ], NOW).congested, true);

// 3) クリーン処理終了(渋滞残なし) → 解消
eq('eval: クリーン処理終了=clear',
  C.evaluate([
    tA(START, '2026-06-12T23:40:00+09:00'),
    tA(CLEAR_CLEAN, '2026-06-13T00:30:00+09:00'),
  ], NOW).congested, false);

// 4) 渋滞残あり だが 3時間超 → 解消扱い
eq('eval: 古い渋滞残=clear',
  C.evaluate([
    tA(START, '2026-06-12T20:00:00+09:00'),
    tA(CLEAR_RESIDUAL, '2026-06-12T20:30:00+09:00'),
  ], NOW).congested, false);

// 5) 工事予定のみ → 解消
eq('eval: 工事予定のみ=clear',
  C.evaluate([tA(WORK, '2026-06-13T00:00:00+09:00')], NOW).congested, false);

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILED'}  (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
