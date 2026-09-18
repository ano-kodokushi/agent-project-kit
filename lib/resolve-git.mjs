// resolve-git.mjs —— 找 git 可执行文件（一处实现，多处复用）
//
// 为什么不直接写 'git'：某些托管环境（含本项目最初开发用的沙箱）**PATH 是空字符串**，
// 裸调 git 会直接失败。这是个真实环境，不是臆想——本仓库的示例驱动器就踩过这个坑：
// 它自己 shell out 调 'git'，而在空 PATH 下静默失败，导致整条闭环崩在第三步。
//
// 解析顺序：环境变量 DSH_GIT -> 常见安装位置 -> PATH 扫描
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @returns {string|null} git 可执行文件绝对路径；找不到返回 null
 */
export function resolveGit() {
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

/** 找不到 git 时给一条人能照着做的报错。 */
export const GIT_NOT_FOUND =
  '找不到 git。请把 git 加入 PATH，或设环境变量 DSH_GIT 指向 git 可执行文件';
