// run-example.mjs —— 端到端跑一遍「完整任务闭环」示例
//
// 它做七步，每一步都断言，任一断言失败即非零退出：
//   ① 把 examples/todo-cli 复制到临时目录
//   ② 用真实 bootstrap.mjs 装配（含 git init + 首次提交）
//   ③ 把 origin 指向一个**本地裸仓库**（不需要网络与任何凭据）
//   ④ 开任务分支
//   ⑤ 干活：实现 T-101（只改 src/format.js）
//   ⑥ 跑该卡的验收命令
//   ⑦ 用真实 push-task.mjs 走完：提交 → 推分支 → 快进合并 main → 推 main
//
// 为什么用本地裸仓库做远端：示例必须**离线可跑、零凭据**，否则别人 clone 下来第一步就卡住。
//
// 边界条件：
//   - 全程只写系统临时目录，不碰仓库内文件（除了读模板）
//   - 不依赖 PATH：node 用 process.execPath，git 用套件共享的 lib/resolve-git.mjs
//     （本脚本第一版直接 shell out 调 'git'，在空 PATH 下静默失败，整条闭环崩在第三步——
//      所以改成复用同一套解析逻辑，而不是各处自己调 'git'）
//   - 跑完不自动清理临时目录，便于人工查看（路径会打印出来）
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGit, GIT_NOT_FOUND } from '../lib/resolve-git.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, '..');            // agent-project-kit/
const SRC = join(HERE, 'todo-cli');         // 示例源
const NODE = process.execPath;              // 当前解释器，避免依赖 PATH
const GIT = resolveGit();

/** 跑一条命令，返回 { code, out }；不抛异常。 */
function run(cmd, args, cwd) {
  if (GIT === null && cmd === GIT) return { code: 127, out: GIT_NOT_FOUND };
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const steps = [];
let failed = 0;

/** 记录一步的结果；不通过就累加失败数。 */
function step(label, ok, detail) {
  steps.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `\n        ${detail}`}`);
  if (!ok) failed += 1;
}

// ── 准备：复制示例到临时目录 ────────────────────────────────────────────────
const root = join(tmpdir(), `kit-example-${Date.now()}`);
const proj = join(root, 'todo-cli');
mkdirSync(root, { recursive: true });
cpSync(SRC, proj, { recursive: true });
steps.push(`INFO  临时项目: ${proj}`);

// ── ② 先建一个本地裸仓库当远端（离线、零凭据），再交给 bootstrap 去配 ────────
// 顺序很重要：bootstrap 只有在收到 --remote 时才会配 origin。
// 第一版没传 --remote，于是后面 `remote set-url` 报 "No such remote 'origin'"。
const bare = join(root, 'origin.git');
const bareInit = run(GIT, ['init', '--bare', bare], root);
step('创建本地裸仓库作为远端', bareInit.code === 0, bareInit.out || bare);

// ── ③ 用真实 bootstrap.mjs 装配（含 git init + 配远端 + 首次提交）────────────
// 先把四件套模板搬进示例（模拟"人写了文档"），bootstrap 会跳过已存在文件。
cpSync(join(KIT, 'AGENTS.md'), join(proj, 'AGENTS.md'));
mkdirSync(join(proj, 'docs'), { recursive: true });
for (const d of ['TASK_BRIEF.md', 'PLAN.md', 'BOARD.md']) {
  cpSync(join(KIT, 'docs', d), join(proj, 'docs', d));
}
const boot = run(NODE, [join(KIT, 'bootstrap.mjs'), proj, '--remote', bare], proj);
step('bootstrap.mjs 装配成功', boot.code === 0, boot.out.split('\n').slice(0, 6).join('\n        '));

const remoteUrl = run(GIT, ['remote', 'get-url', 'origin'], proj).out;
step('bootstrap 已配好 origin', remoteUrl === bare, remoteUrl);

// ── ④ 开任务分支 ────────────────────────────────────────────────────────────
const branch = 'feat/T-101-清单标题横幅前缀';
const co = run(GIT, ['switch', '-c', branch], proj);
step('已开任务分支', co.code === 0, co.out);

// ── ⑤ 干活：实现 T-101 ──────────────────────────────────────────────────────
// 该卡允许且**要求**改三处：src/format.js 加前缀；test/run.js 里两条**写死了标题**的期望值同步。
// 这正是这张示例卡想演示的东西——**改行为必须同步改受影响的所有期望值，但不许动别的断言**。
//
// 实测教训：第一版只同步了 `formatList` 那条，于是 `formatHeader(0)` 那条仍然失败。
// **改行为时要搜全所有断言，而不是只改你第一眼看到的那条。**
//
// 改法用「整行替换 + 找不到就报错」，而不是字符串内联转义：
// 把 `\n` 写成两个字符去匹配源码里的转义序列，转义层数一多就写错，且会静默匹配失败。
const formatPath = join(proj, 'src', 'format.js');
const testPath = join(proj, 'test', 'run.js');

/** 把某个文件里「包含 markerLine 的整行」替换为 replacement；找不到就返回 false。 */
function replaceLine(file, markerLine, replacement) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(markerLine));
  if (i === -1) return false;
  lines[i] = replacement;
  writeFileSync(file, lines.join('\n'), 'utf8');
  return true;
}

const editFormat = replaceLine(
  formatPath,
  'return `待办清单（${count} 项）`;',
  '  return `== 待办清单（${count} 项）`;',
);
step('实现：formatHeader 加横幅前缀', editFormat, editFormat ? undefined : 'src/format.js 里找不到待改行');

const editExpect1 = replaceLine(
  testPath,
  "assert.equal(out, '待办清单（2 项）",
  "  assert.equal(out, '== 待办清单（2 项）\\n[ ] A\\n[x] B');",
);
step('同步：formatList 内嵌标题的期望值', editExpect1, editExpect1 ? undefined : 'test/run.js 里找不到该断言');

const editExpect2 = replaceLine(
  testPath,
  "assert.equal(formatHeader(0), '待办清单（0 项）');",
  "  assert.equal(formatHeader(0), '== 待办清单（0 项）');",
);
step('同步：formatHeader(0) 的期望值', editExpect2, editExpect2 ? undefined : 'test/run.js 里找不到该断言');

// ── ⑥ 跑该卡的验收命令 ─────────────────────────────────────────────────────
const test = run(NODE, [join(proj, 'test', 'run.js')], proj);
step('验收通过：node test/run.js -> PASS 7/7', test.code === 0 && test.out.startsWith('PASS 7/7'), test.out);

// ── ⑦ 用真实 push-task.mjs 收口 ─────────────────────────────────────────────
const push = run(NODE, [join(KIT, 'push-task.mjs'), proj, '-m', 'feat(T-101): 清单标题加横幅前缀'], proj);
step('push-task.mjs 走完闭环', push.code === 0, push.out);

// ── 最终断言：远端真的收到了东西 ────────────────────────────────────────────
const localMain = run(GIT, ['rev-parse', 'main'], proj).out;
const remoteMain = run(GIT, ['rev-parse', 'main'], bare).out;
step('远端 main == 本地 main', localMain === remoteMain && localMain.length === 40,
  `local=${localMain}\n        remote=${remoteMain}`);

const remoteLog = run(GIT, ['log', '--oneline', 'main'], bare).out;
step('远端有 2 个提交（初始 + T-101）', remoteLog.split('\n').filter(Boolean).length === 2,
  remoteLog.split('\n').join('\n        '));

const remoteBranches = run(GIT, ['branch'], bare).out;
step('远端有 main 与任务分支', remoteBranches.includes('main') && remoteBranches.includes('T-101'),
  remoteBranches.split('\n').join(' / '));

const clean = run(GIT, ['status', '--porcelain'], proj).out === '';
step('工作区干净', clean);

// ── 汇总 ────────────────────────────────────────────────────────────────────
process.stdout.write(`${steps.join('\n')}\n`);
process.stdout.write(`\n${failed === 0 ? '===== 示例闭环全部通过 =====' : `===== ${failed} 步失败 =====`}\n`);
process.exitCode = failed === 0 ? 0 : 1;
