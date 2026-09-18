// bootstrap.mjs —— 把「Agent 项目治理套件」装到一个项目上
//
// 做四件事：① 检查 git ② 需要就 git init + 首次提交 ③ 缺远端就配一个
//           ④ 复制四件套文档（TASK_BRIEF / AGENTS / PLAN / BOARD）
//
// 为什么不覆盖已有文件：这套文档是要长期积累的（BOARD 记历史、AGENTS 记教训），
//   覆盖等于把积累清空。已存在的一律跳过并打印 SKIP。
//
// 边界条件：
//   - 只接受绝对路径（避免相对路径漂移到别处）
//   - 项目目录不存在则创建
//   - 远端是可选的：给了就配 origin，没给就打印怎么补
//   - git 与文档互不阻塞：git 失败仍继续装文档，反之亦然
//   - 全程打印它真正做了什么，不静默
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = [
  '用法: node bootstrap.mjs <项目绝对路径> [--name 项目名] [--remote <url>] [--no-git] [--dry-run]',
  '  例: node bootstrap.mjs "C:\\work\\my-app" --remote git@github.com:me/my-app.git',
  '  --dry-run 只打印将要做什么，不写任何东西，用来安全试跑',
].join('\n');

// 模板与本脚本同目录：HERE 就是 agent-project-kit/。
// 按脚本自身位置推算，不写死盘符，也不假设调用时的工作目录。
const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = HERE;

/**
 * 找 git 可执行文件。
 * 为什么不直接写 'git'：某些托管环境（含本项目最初开发用的沙箱）**PATH 是空字符串**，
 * 裸调 git 会直接失败——这是个真实环境，不是臆想。所以先试常见绝对路径，再回退到 PATH 扫描。
 * 需要覆盖时设环境变量 DSH_GIT。
 * @returns 绝对路径；找不到返回 null
 */
function resolveGit() {
  if (process.env.DSH_GIT !== undefined) return process.env.DSH_GIT;
  const names = ['git.exe', 'git'];
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((d) => join(d, 'Git', 'cmd'));
  for (const dir of roots) {
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  }
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (dir === '') continue;
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}

const GIT = resolveGit();

// [模板里的相对路径, 项目里的相对路径]
const DOCS = [
  ['AGENTS.md', 'AGENTS.md'],
  [join('docs', 'TASK_BRIEF.md'), join('docs', 'TASK_BRIEF.md')],
  [join('docs', 'PLAN.md'), join('docs', 'PLAN.md')],
  [join('docs', 'BOARD.md'), join('docs', 'BOARD.md')],
];

/** 解析 CLI。 */
function parseCli(argv) {
  const project = argv[0];
  if (project === undefined || project.startsWith('--')) throw new Error(USAGE);
  if (!isAbsolute(project)) throw new Error(`项目路径必须是绝对路径: ${project}`);
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    project,
    name: flag('--name') ?? basename(project),
    remote: flag('--remote'),
    skipGit: argv.includes('--no-git'),
    dryRun: argv.includes('--dry-run'),
  };
}

/** 运行 git 并回传结果；不抛异常，由调用方决定怎么处理。 */
function git(args, cwd) {
  if (GIT === null) {
    return { code: 127, out: '找不到 git。请把 git 加入 PATH，或设环境变量 DSH_GIT 指向 git 可执行文件' };
  }
  const r = spawnSync(GIT, args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function main(argv) {
  let cli;
  try {
    cli = parseCli(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (!existsSync(TEMPLATE)) {
    process.stderr.write(`错误: 找不到模板目录 ${TEMPLATE}\n`);
    return 1;
  }
  const steps = [];

  // ① 项目目录
  if (!existsSync(cli.project)) {
    if (cli.dryRun) steps.push(`WOULD  CREATE 项目目录 ${cli.project}`);
    else {
      mkdirSync(cli.project, { recursive: true });
      steps.push(`CREATE 项目目录 ${cli.project}`);
    }
  } else {
    steps.push(`EXISTS 项目目录 ${cli.project}`);
  }
  if (cli.dryRun) {
    steps.push('WOULD  按下列清单执行（dry-run，未写任何文件）');
    steps.push(`       文档模板源 = ${TEMPLATE}`);
    for (const [, dest] of DOCS) {
      steps.push(`       ${existsSync(join(cli.project, dest)) ? 'SKIP  ' : 'CREATE'} ${dest}`);
    }
    if (!cli.skipGit) {
      steps.push(`       ${cli.remote === undefined ? 'SKIP   远端（没给 --remote）' : `CREATE 远端 origin -> ${cli.remote}`}`);
    }
    process.stdout.write(`${steps.join('\n')}\n`);
    return 0;
  }

  // ② git 仓库 + 首次提交 + 远端
  if (cli.skipGit) {
    steps.push('SKIP   git（--no-git）');
  } else {
    const inside = git(['rev-parse', '--is-inside-work-tree'], cli.project);
    if (inside.code === 0) {
      steps.push('EXISTS git 仓库');
    } else {
      // 不用 `git init -b main`：-b 要 git ≥ 2.28，本机实测是 2.26.0（AGENTS.md §2）。
      const init = git(['init'], cli.project);
      if (init.code !== 0) {
        steps.push(`FAIL   git init: ${init.out}`);
      } else {
        const rename = git(['checkout', '-b', 'main'], cli.project);
        steps.push(rename.code === 0 ? 'CREATE git 仓库（main 分支）' : `WARN   git init 成功但切 main 失败: ${rename.out}`);
      }
      git(['config', 'user.name'], cli.project);
    }
    if (cli.remote !== undefined) {
      const cur = git(['remote', 'get-url', 'origin'], cli.project);
      if (cur.code === 0) {
        steps.push(`EXISTS 远端 origin -> ${cur.out}`);
      } else {
        const add = git(['remote', 'add', 'origin', cli.remote], cli.project);
        steps.push(add.code === 0 ? `CREATE 远端 origin -> ${cli.remote}` : `FAIL   remote add: ${add.out}`);
      }
    } else {
      steps.push('SKIP   远端（没给 --remote）');
    }
  }

  // ③ 四件套文档（已存在一律跳过，绝不覆盖）
  for (const [src, dest] of DOCS) {
    const target = join(cli.project, dest);
    if (existsSync(target)) {
      steps.push(`SKIP   ${dest}（已存在，不覆盖）`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(TEMPLATE, src), target);
    steps.push(`CREATE ${dest}`);
  }

  // ④ 首次提交（只在确有待提交内容时）
  if (!cli.skipGit) {
    const st = git(['status', '--porcelain'], cli.project);
    if (st.code === 0 && st.out.length > 0) {
      git(['add', '-A'], cli.project);
      const commit = git(['commit', '-m', 'chore: 装入 Agent 项目治理套件（任务书/治理书/计划书/协调板）'], cli.project);
      steps.push(commit.code === 0 ? 'CREATE 首次提交' : `WARN   提交失败（可能未配 user.email），文档已就位，手动提交即可`);
    } else {
      steps.push('SKIP   首次提交（无待提交内容）');
    }
  }

  process.stdout.write(`${steps.join('\n')}\n`);
  if (cli.remote === undefined) {
    process.stdout.write('\n下一步：配远端\n  git remote add origin <你的仓库地址>\n  git push -u origin main\n');
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
