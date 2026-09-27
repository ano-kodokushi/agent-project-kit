# agent-project-kit

让 AI 编码助手稳定干活的最小治理套件：四个文档 + 两个脚本，把"靠模型自觉"换成"靠机器执行"。

与具体产品无关。只要助手会读仓库根目录的 `AGENTS.md`，Claude Code、Codex、Cursor 或自建的 agent 都能用。

## 它解决的那个循环

AI 写代码时最常见的失败不是写错，而是这个循环：

```
① 它说"已完成"        →  ② 你没验就信了    →  ③ 三天后发现没做完
        ↑                                              │
        └──────── 重讲一遍需求、重踩一遍坑 ─────────────┘
```

每转一圈，付出的是返工加上重新交代上下文的成本。四份文档断掉②，两个脚本断掉①。
三种典型症状，中了才值得用：

| 症状 | 表现 | 对策 |
|---|---|---|
| 说完成其实没验 | "已实现并通过测试"，其实没跑 | `AGENTS.md` 要求写可复制的验收命令，任务卡必须带通过标准 |
| 换个会话就断片 | 上一轮的结论和踩过的坑全丢了 | `docs/BOARD.md` 作为唯一真相源，交接写在文件里而不是聊天里 |
| 跑偏没人拦 | 让它改 A，它顺手重构了 B 和 C | `push-task.mjs` 拒绝在 `main` 上直接提交，强制走任务分支 |

三条都没中，这套东西只会增加写文档的负担。

## 规矩由脚本执行，不由提示词执行

治理书里写"禁止直接向 main 提交"拦不住人，所以交给脚本：

```console
$ node push-task.mjs . -m "hotfix: 紧急修一下"
FAIL   当前在 main 上。治理书 §3 禁止直接向 main 提交。
       先开分支: git switch -c feat/T-xxx-描述
       （本脚本不会替你开分支——分支名是有意义的，得你或 Agent 起）
```

同一个脚本还会拒绝空提交、缺提交信息、没配远端，并在非快进合并时中止并切回原分支，不改写历史。

## 快速开始

需要 Node ≥ 18。git 在不在 `PATH` 里都行，脚本会自己找。

```bash
# 1) 装机（--dry-run 先看它要做什么，不写任何东西）
node bootstrap.mjs "/path/to/my-app" --remote "git@github.com:me/my-app.git" --dry-run
node bootstrap.mjs "/path/to/my-app" --remote "git@github.com:me/my-app.git"

# 2) 干活
cd /path/to/my-app
git switch -c feat/T-012-user-login
#   ...改代码、跑验收...
node /path/to/agent-project-kit/push-task.mjs "$PWD" -m "feat(T-012): 用户登录"
```

`bootstrap.mjs` 复制 `AGENTS.md` 与 `docs/` 下的三份模板（`TASK_BRIEF` / `PLAN` / `BOARD`）；
已存在的文件一律跳过、绝不覆盖；没给 `--remote` 时打印补配远端的两条命令。

`push-task.mjs` 的拒绝清单：当前在 `main` 上 · 工作区无改动 · 缺 `-m` · 没配 `origin` · 非快进合并（中止并切回原分支）。
另有 `--no-merge`（推分支就停，留给你建 PR）与 `--dry-run`（只打印计划）。

## 验证：七步闭环，每步断言

```bash
git clone https://github.com/ano-kodokushi/agent-project-kit
cd agent-project-kit
node examples/run-example.mjs
```

它会在系统临时目录里建一个真实项目，调用真实的 `bootstrap.mjs` 与 `push-task.mjs` 走完
「装机 → 开分支 → 干活 → 推分支 → 合并」整条闭环，任一步失败即非零退出。远端用本地裸仓库，
所以零凭据、离线可跑。这是本仓库的回归测试，不是演示数据。

```
PASS  远端 main == 本地 main
PASS  远端有 2 个提交（初始 + T-101）
PASS  远端有 main 与任务分支
PASS  工作区干净

===== 示例闭环全部通过 =====
```

七步各做什么、示例为什么挑 `T-101` 这张卡（它会撞坏一条既有断言），见
[docs/RATIONALE.md](docs/RATIONALE.md)。

## 目录结构

```
AGENTS.md                 模板：仓库治理书（Agent 的入口）
bootstrap.mjs             一键装机
push-task.mjs             任务闭环推送
examples/                 可跑的回归测试（七步闭环）
lib/                      git 解析等共享逻辑
docs/TASK_BRIEF.md        模板：项目任务书
docs/PLAN.md              模板：执行计划书
docs/BOARD.md             模板：协调板
docs/RATIONALE.md         设计说明：为什么是这四份、怎么落地
```

模板约定：`<!-- 填写 -->` 是待替换的占位内容；`### T-XXX` 是示例任务，可直接删掉替换；
方括号 `[ ]` 是勾选框，完成后改成 `[x]`。

## 延伸阅读

- [docs/RATIONALE.md](docs/RATIONALE.md) —— 四个坑各对应哪份文档、上手顺序、脚本里那些"多余"的防御为什么必要
- [dsh-tiered-collab](https://github.com/ano-kodokushi/dsh-tiered-collab) —— 在这套治理之上，
  把任务按难度分层派给不同档位的子代理（规划 / 执行 / 复核），并记录一份真实的踩坑清单。
  只用一套通用 agent 的话，本套件就够了；想进一步压成本和提质量再看那个。

## License

MIT
