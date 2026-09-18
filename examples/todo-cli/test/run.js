// test/run.js —— 自检脚本。退出码 0 = 全过；非 0 = 有失败项。
// 零依赖，用 node 内置 assert。
import assert from 'node:assert/strict';
import { formatHeader, formatItem, formatList } from '../src/format.js';

let passed = 0;
const failures = [];

/** 跑一个断言，失败不中断，收集起来最后汇总。 */
function check(label, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${label}\n      ${error.message.split('\n')[0]}`);
  }
}

check('formatItem 未完成用 [ ]', () => {
  assert.equal(formatItem({ id: 1, text: '买菜', done: false }), '[ ] 买菜');
});

check('formatItem 已完成用 [x]', () => {
  assert.equal(formatItem({ id: 2, text: '交房租', done: true }), '[x] 交房租');
});

check('formatList 空清单返回提示行', () => {
  assert.equal(formatList([]), '（暂无待办）');
});

check('formatList 首行是标题、其后逐条', () => {
  const out = formatList([
    { id: 1, text: 'A', done: false },
    { id: 2, text: 'B', done: true },
  ]);
  assert.equal(out, '待办清单（2 项）\n[ ] A\n[x] B');
});

check('formatHeader 单行输出', () => {
  const out = formatHeader(3);
  assert.ok(!out.includes('\n'), '不应包含换行');
});

// T-101 要求：横幅 —— 空清单时引导用户，并且不丢失小计
check('formatHeader 报告小计', () => {
  assert.equal(formatHeader(0), '待办清单（0 项）');
});

check('formatHeader 带横幅前缀', () => {
  // T-101 的验收：标题行必须以 '== ' 起头
  assert.ok(formatHeader(3).startsWith('== '), `实际: ${JSON.stringify(formatHeader(3))}`);
});

if (failures.length === 0) {
  process.stdout.write(`PASS ${passed}/${passed}\n`);
  process.exitCode = 0;
} else {
  process.stdout.write(`FAIL ${failures.length} 项（通过 ${passed} 项）\n`);
  for (const f of failures) process.stdout.write(`  ✗ ${f}\n`);
  process.exitCode = 1;
}
