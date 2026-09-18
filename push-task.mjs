// push-task.mjs —— 任务闭环推送器（替代"直接推 main"）
//
// 为什么需要它：治理书 §3 写着「禁止直接向 main 提交，一律走分支 + 合并」，
//   而原来的流程是直接 commit+push 到 main —— 自相矛盾。本脚本把分支闭环固化下来：
//     当前分支(不能是 main) → 提交 → 推分支 → 快进合并进 main → 推 main
//
// 为什么要"合并进 main"而不是留 PR：本地 Agent 场景下没人去点合并，留 PR 等于活干完了
//   却永远不进主干。所以默认合并，并打印一个 GitHub 建 PR 的链接供你查差异留痕。
//   想要纯 PR 流程（不自动合并）就加 --no-merge。
//
// 边界条件：
//   - 工作区有未提交改动 -> 按 --message 提交；没有改动 -> 报错退出（不产生空提交）
//   - 当前在 main 上 -> 拒绝执行，并告诉你怎么先开分支（绝不偷偷替你建）
//   - 非快进合并 -> 中止合并、回到干净状态，要求人工处理（不改写任何历史）
//   - 远端未配 -> 提示先配 origin
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGit, GIT_NOT_FOUND } from './lib/resolve-git.mjs';

const USAGE = [
  '用法: node push-task.mjs <仓库绝对路径> --message "commit message" [--no-merge] [--dry-run]',
  '  例: node push-task.mjs "C:\\work\\app" -m "feat(retrieve): 加 RRF 融合"',
  '  约定: -m 与 --message 等价；-n 与 --dry-run 等价',
].join('\n');

// git 解析抽到 lib/ 共享，避免每个脚本各写一遍（示例驱动器就因各写一遍而踩过坑）
const GIT = resolveGit();
const MAIN = 'main';

/** 跑一条 git 命令，返回 { code, out }。不抛异常，由调用方判断。 */
function git(args, cwd) {
  if (GIT === null) return { code: 127, out: GIT_NOT_FOUND };
  const r = spawnSync(GIT, args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** 取一个 flag 的值，支持 `-m x` 与 `--message x` 两种写法。 */
function valueOf(argv, ...names) {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i !== -1) return argv[i + 1];
  }
  return undefined;
}

function main(argv) {
  const repo = argv[0];
  if (repo === undefined || repo.startsWith('-')) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!existsSync(repo)) {
    process.stderr.write(`错误: 仓库路径不存在 ${repo}\n`);
    return 1;
  }
  const message = valueOf(argv, '--message', '-m');
  const noMerge = argv.includes('--no-merge');
  const dryRun = argv.includes('--dry-run') || argv.includes('-n');

  const steps = [];
  const fail = (msg) => {
    process.stderr.write(`${steps.join('\n')}\nFAIL   ${msg}\n`);
    return 1;
  };

  if (git(['rev-parse', '--is-inside-work-tree'], repo).code !== 0) {
    return fail(`${repo} 不是 git 仓库`);
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).out;
  if (branch === MAIN) {
    return fail(`当前在 ${MAIN} 上。治理书 §3 禁止直接向 ${MAIN} 提交。\n`
      + `       先开分支: git switch -c feat/T-xxx-描述\n`
      + `       （本脚本不会替你开分支——分支名是有意义的，得你或 Agent 起）`);
  }
  const dirty = git(['status', '--porcelain'], repo).out;
  if (dirty === '') {
    return fail('工作区没有未提交改动，不产生空提交。先改点东西，或检查是不是已经提交过了');
  }
  if (message === undefined || message.trim() === '') {
    return fail('缺 --message/-m。提交信息按 Conventional Commits 写，例如 "feat(retrieve): 加 RRF 融合"');
  }
  if (git(['remote', 'get-url', 'origin'], repo).code !== 0) {
    return fail('没有配 origin。先 git remote add origin <url>');
  }

  // —— 计划（dry-run 只打印）——
  const plan = [
    `COMMIT  在 ${branch} 上提交: ${message.trim()}`,
    `PUSH    推送分支 ${branch} 到 origin`,
    noMerge ? 'SKIP    合并进 main（--no-merge）' : `MERGE   快进合并 ${branch} -> ${MAIN}，并推送 ${MAIN}`,
  ];
  if (dryRun) {
    process.stdout.write(`WOULD  ${plan.join('\n       ')}\n`);
    return 0;
  }

  // —— 执行 ——
  if (git(['add', '-A'], repo).code !== 0) return fail('git add 失败');
  const commit = git(['commit', '-m', message.trim()], repo);
  if (commit.code !== 0) return fail(`提交失败: ${commit.out}`);
  steps.push(`OK    已提交 ${git(['rev-parse', '--short', 'HEAD'], repo).out}`);

  const pushBranch = git(['push', '-u', 'origin', branch], repo);
  if (pushBranch.code !== 0) return fail(`推送分支失败: ${pushBranch.out}`);
  steps.push(`OK    已推送分支 ${branch}`);

  if (noMerge) {
    steps.push('SKIP  按 --no-merge 停留在分支，未合并进 main');
    process.stdout.write(`${steps.join('\n')}\n`);
    return 0;
  }

  const co = git(['switch', MAIN], repo);
  if (co.code !== 0) return fail(`切到 ${MAIN} 失败: ${co.out}`);
  const merge = git(['merge', '--ff-only', branch], repo);
  if (merge.code !== 0) {
    git(['merge', '--abort'], repo);
    git(['switch', branch], repo);
    return fail(`${MAIN} 与 ${branch} 不是快进关系，已中止合并并切回 ${branch}。`
      + `\n       需要人工处理（rebase 或真合并），本脚本不改写历史`);
  }
  steps.push(`OK    已快进合并 ${branch} -> ${MAIN}`);

  const pushMain = git(['push', 'origin', MAIN], repo);
  if (pushMain.code !== 0) return fail(`推送 ${MAIN} 失败: ${pushMain.out}`);
  steps.push(`OK    已推送 ${MAIN}`);

  // 只有 http(s) / git@host:path 这两类远端能拼出网页比较链接；
  // 本地路径（如 /tmp/x.git）拼不出，静默跳过，不要输出无意义的 URL。
  const remote = git(['remote', 'get-url', 'origin'], repo).out;
  const web = remote.startsWith('git@')
    ? remote.replace(/^git@([^:]+):/, 'https://$1/')
    : (remote.startsWith('http') ? remote : undefined);
  if (web !== undefined) {
    steps.push(`INFO  差异查看 / 可建 PR: ${web.replace(/\.git$/, '')}/compare/${MAIN}...${branch}?expand=1`);
  } else {
    steps.push(`INFO  远端是本地路径（${remote}），无可用的网页比较链接`);
  }
  process.stdout.write(`${steps.join('\n')}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
