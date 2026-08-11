# omo -> OpenCode2 移植设计文档

> 创建: 2026-08-10
> 基线: 本 fork @ `70e0f5032`(upstream dev, PR #6667 合并后);opencode2 = anomalyco/opencode `v2` 分支 @ `84fd347a`;插件 API 以 npm `@opencode-ai/plugin@0.0.0-next-17055` 的发布类型为准。
> 状态: Phase 0 Spike 已完成并全绿(PASS=15/15,证据 `.omo/evidence/20260810-opencode2-spike/`);设计已按 spike 发现修订(见第 8 章 R11-R13)。

## 0. TL;DR

在 fork 里**新增一个 Adapter 包 `packages/omo-opencode2/`**,遵循 ROADMAP 的 Core/MCP/Skills/Adapters 分层,复用 19 个 harness-neutral Core 包,把 omo 的多 agent 架构(11 agents + categories + 编排)、goal、ulw-loop、ultrawork 关键词检测、守卫 hooks、内置 MCP 移植到 OpenCode2 的新插件 API。**不改 `packages/omo-opencode/`(v1 适配器继续服役)**,唯一触碰现有代码的是把 7 个内联 prompt 家族抽到新 Core 包 `packages/agents-core/`(纯移动 + re-export)。

Subagent 策略:**原生优先,omo 补齐**——omo 的 agents/categories 全部注册为标准 v2 subagent,让 opencode2 原生 `subagent` 工具可以直接派发;omo 自研 `task` 工具只保留原生做不到的能力(category 动态路由、task_id 续聊、并发上限、load_skills、失败回退、后台任务 registry)。

## 1. 范围

### 1.1 移植范围(用户确认)

| 模块 | 内容 |
|---|---|
| 多 agent 架构 | sisyphus / hephaestus / prometheus / atlas(primary)+ oracle / librarian / explore / multimodal-looker / metis / momus / sisyphus-junior(subagent) |
| 模型解析 | `AGENT_MODEL_REQUIREMENTS` / `CATEGORY_MODEL_REQUIREMENTS` fallback 链、categories(visual-engineering/ultrabrain/deep/artistry/quick/unspecified-low/unspecified-high/writing) |
| 编排 | `task`(delegate,含 sync/background/continuation)、后台任务引擎(并发上限、parent wake)、`background_output`/`background_cancel` |
| goal | `create_goal`/`update_goal`/`get_goal` 工具、`/goal` 命令、idle continuation、`default_mode.goal` |
| ulw-loop | CLI 引擎(create-goals/status/checkpoint/steer/...)+ stop 续跑 + skills(ulw-loop/ultrawork/ulw-plan/ulw-research) |
| keyword-detector | ultrawork/ulw、hyperplan/hpp、hyperplan-ultrawork 组合检测 + 按模型家族路由注入;`default_mode.ultrawork`(team 关键词在 v2 不迁移,见 5.E) |
| 守卫 hooks | write-existing-file-guard、comment-checker、hashline(read-enhancer + edit 工具)、prometheus-md-only、delegate-task-retry、empty-task-response-detector |
| MCP | codegraph、lsp(本地 stdio)+ websearch、context7、grep_app(远程 HTTP) |
| Skills/Commands | shared-skills 注册、omo 内建命令 |
| 配置 | omo-config-core(omo.json 多层链)+ `ctx.options` |

### 1.2 明确不移植

team-mode(12 个 team_* 工具 + 全部 team hooks)、claude-code 兼容层(plugin-loader/session-state/marketplace)、openclaw、monitor、tmux/interactive_bash、TUI sidebar、telemetry、Boulder。`call_omo_agent` 工具不单独移植(能力并入 `task`,见第 6 章)。

## 2. 事实核查(全部经源码验证)

### 2.1 opencode2 侧

源码: anomalyco/opencode `v2` 分支(clone 于 2026-08-10)。注意 `dev`/`production` 分支上的 `packages/plugin` 是旧版,**v2 分支才是 opencode2**;v1 插件运行时(14 个 hook 点那套)在 v2 分支上**不存在**(`packages/opencode` 目录已删除,引擎在 `packages/core`)。所以移植 = 写新 adapter,不是改旧插件。

已验证的 API 事实:

- **插件定义**: `export default Plugin.define({ id, setup(ctx) })`,Promise API 入口 `@opencode-ai/plugin`;npm 包可直接 `"exports": "./src/index.ts"` 发 TS 源码(v2 运行时是 Bun)。`setup` 可返回 cleanup;注册随插件作用域自动释放。
- **Context 域**(dist/promise/plugin.d.ts): `app, options, agent, aisdk, catalog, command, event, integration, plugin, reference, session, shell, skill, tool, websearch`。
- **Agent transform**: `ctx.agent.transform(draft => ...)`;`AgentDraft = { list, get, default, update, remove }`,其中 **`update` 是 upsert**(`packages/core/src/agent.ts`: `draft.agents.get(id) ?? Info.empty(id)`),即插件可以创建全新 agent。`reload()` 重放全部 transform。
- **Agent.Info 形状**(`packages/schema/src/agent.ts`): `{ id, model?: {id, providerID, variant?}, request: {settings, headers, body}, system?, description?, mode: "subagent"|"primary"|"all", hidden, color?, steps?, permissions: [{action, resource, effect: allow|deny|ask}] }`。**没有 `order` 字段**(排序见风险 R3)。
- **SessionDomain**(`packages/plugin/src/promise/session.ts`): `create/get/prompt/generate/command/synthetic/interrupt` + `hook("context"|"http.request"|"http.response")`。
  - `prompt({sessionID, text, files?, agents?, skills?, metadata?, delivery?, resume?})`: `resume !== false` 时自动唤醒执行(`packages/core/src/session.ts:603`),返回 durable 的 pending 记录(同步受理,无 v1 promptAsync 的"未持久化即返回"问题)。
  - `synthetic({sessionID, text, description?, metadata?, delivery?: "steer"|"queue", resume?})`: **一等公民的内部消息注入原语**,durable 排队——v1 `prompt-async-gate` 要解决的那类问题在 v2 被结构性消除。
  - 公开桥接的 `create` **不转发 parentID**(`packages/core/src/plugin/promise.ts:271-292` 只映射 id/agent/model/location)——父子关系需插件侧自建 registry(风险 R2)。
  - **没有 `messages` 读取 API**;子会话输出从事件流拿(`session.text.ended` 带全文)。文档承诺的 `wait` 在已发布类型中尚未出现(风险 R1)。
- **context hook**(`packages/core/src/session/model-request.ts:199-217`): `{sessionID, agent, model, system: SystemPart[], messages: Message[], tools: Record<name,{description,input}>}` 全部可变;可删工具、改工具描述/schema、甚至改名。每次模型调用前触发——覆盖 v1 的 `chat.message`/`chat.params`/`system.transform`/`messages.transform` 四个 hook 点的绝大部分用途。
- **ToolDomain**: `transform` 的 `draft.add({ name, description, input: JSONSchema 或 effect Schema, output?, execute(input, ctx), options: { namespace?, codemode? } })`;`hook("execute.before")` 的 `input` 可变,`hook("execute.after")` 的 `result`/`error` **可变**(触发后回读突变,`packages/core/src/tool.ts:99-136`——文档写 "Terminal" 是文档滞后)。工具执行 ctx 含 `{ id, sessionID, agent, messageID, progress }`。
- **aisdk.hook("sdk"|"language")**: 可换 SDK/language 实例;`model` 只读。
- **http.request/http.response hooks**: 仅 native 模型路径经过;AI SDK 模型不经过(文档明示)。
- **event.subscribe()**: `AsyncIterable`,类型化事件: `session.created/idle/deleted`、`session.execution.started/succeeded/failed/interrupted`、`session.step.started/ended/failed`、`session.text.ended`(带 text 全文)、`session.tool.called/progress`、`session.compaction.started/ended/failed`、`session.retry.scheduled`、`permission.asked`、`mcp.status.changed`、`skill.updated`、`config.updated` 等。
- **skill.transform**: `draft.source(source)`,`Source = {type:"directory", path} | {type:"url", url} | {type:"embedded", skill: Info}`(`packages/schema/src/skill.ts`)——支持目录、URL、**内嵌整个 skill**三种注册方式。
- **command.transform**: `list/get/update/remove`,`update` 同样是 upsert(参照 `packages/core/src/config/plugin/command.ts` 的用法);`CommandInfo = { name, template, description?, agent?, model?, subtask? }`。
- **catalog.transform**: provider/model 的 list/get/update/remove + `model.default.set(providerID, modelID)`;model 支持 variants(每个 variant 带 settings/headers/body)。
- **原生 subagent 工具**(`packages/core/src/tool/plugin/subagent.ts`,本身就是插件 API 写的,是最好的参考实现): 名称 `subagent`,参数 `{agent, description, prompt, background?}`;深度限制 `experimental.subagent_depth`(默认 1);模型取 `agent.model ?? parent.model`;background 完成时向父会话 `synthetic` 注入 `<subagent ...>` 完成通知;context hook 动态把可用 subagent 列表追加到工具描述。
- **MCP 无插件 API**(ctx 没有 mcp 域)。走配置: `opencode.json(c)` 的 `mcp.servers`(v2 分支 `packages/schema/src/config/mcp.ts`): local `{type:"local", command, cwd?, environment?, disabled?, codemode?, timeout?}` / remote `{type:"remote", url, headers?, oauth?, disabled?, codemode?}`。**`codemode` 默认 `true`**(工具被收进 CodeMode 的 `execute` 里,模型看不到独立工具)——omo 的 lsp/codegraph 必须显式 `codemode: false`。v2 用 `disabled`(没有 `enabled` 字段)。
- **配置位置**: 全局 `~/.config/opencode/opencode.json(c)`;项目 `opencode.json(c)` 或 `.opencode/opencode.json(c)`(向上查找+合并)。插件声明: `"plugins": ["pkg@version", "./local.ts", { "package": "...", "options": {...} }]`;`.opencode/plugins/` 目录自动发现。

### 2.2 omo 侧(本 fork)

- 11 agents 的工厂/权限/模型要求: `packages/omo-opencode/src/agents/`(注册表 `builtin-agents.ts`;Prometheus 特殊走 `plugin-handlers/prometheus-agent-config-builder.ts`)。
- 模型解析纯逻辑在 `packages/model-core/`(`agent-model-requirements.ts`、`category-model-requirements.ts`、`model-resolution-pipeline.ts`,`ProviderCache` 是 DI 接口)——**零 `@opencode-ai/*` 依赖,直接复用**。
- prompts: atlas/prometheus/ultrawork/mode 在 `packages/prompts-core/`(harness-neutral,有 coupling 审计测试守护);**sisyphus(10 个模型家族变体)、hephaestus、oracle、librarian、explore、metis、momus、sisyphus-junior 的 prompt 内联在 `packages/omo-opencode/src/agents/*.ts`**——需要抽取(第 4 章)。
- delegate: `tools/delegate-task/`(参数 `prompt/description/load_skills/run_in_background/category/subagent_type/task_id/command`;sync 链 = create→prompt→poll→fetch;background 走 BackgroundManager);`call_omo_agent` 只允许 explore/librarian。模型选择/重试模式在 `packages/delegate-core/`(纯 TS)。
- 后台引擎: `features/background-agent/`(并发 5/`${providerID}/${modelID}`、3s 轮询 + idle 事件双条件、parent wake 走 `dispatchInternalPrompt`)。
- goal: `hooks/goal/`(event 钩 session.idle → `dispatchInternalPrompt` 续跑;状态 `.omo/goal/{sessionID}.json`;工具三件套;`/goal` 内建命令;`default_mode.goal` 首消息自动建 goal)。注意: OpenCode 版 Goal 无 successCriteria 字段;`pi-goal` 包是已有的移植先例。
- ulw-loop: **OpenCode 侧只是 CLI 透传**(`cli/codex-ulw-loop.ts`);真正的引擎是 `packages/omo-codex/plugin/components/ulw-loop/`(独立 Node CLI,状态在 `.omo/ulw-loop/`: `goals.json`/`ledger.jsonl`/evidence 目录;子命令 create-goals/status/complete-goals/checkpoint/steer/add-goal/criteria/record-evidence/record-review-blockers)。harness 耦合点只有 3 个 Codex hook: UserPromptSubmit(ultrawork 指令+steering)、PreToolUse(create_goal 预算守卫)、Stop(block+resume 指令,two-strike 防卡死 RESUME_CAP=2)。
- keyword-detector: `hooks/keyword-detector/`,v1 钩 `chat.message`(每条用户消息都检测,非仅首条);现存关键词只有 `ultrawork`/`team`/`hyperplan`/`hyperplan-ultrawork`(**search/analyze 已删除**,根 AGENTS.md 的描述过时);注入位置是首个真实用户 text part;`default_mode.ultrawork` 走 `experimental.chat.system.transform`(检查 `<ultrawork-mode>` 存在性,compaction-safe);另有独立的 ultrawork 模型覆盖(`ultrawork-model-override.ts`)。
- todo-continuation-enforcer: `hooks/todo-continuation-enforcer/`(~1700 行状态机: cooldown/退避/防循环/打断检测),续跑同样走 `dispatchInternalPrompt`。
- MCP: `packages/omo-opencode/src/mcp/`(websearch/context7/grep_app 远程;lsp/codegraph 本地 stdio;解析逻辑在 `packages/utils/`: `resolveCodegraphCommand`、`ancestor-cli-resolver`)。
- 配置链: `packages/omo-config-core/`(纯 TS;用户层 `~/.omo/omo.json[c]` + 项目层向上查找 + profiles + harness 块)。
- 已核实零 `@opencode-ai/*` 依赖、可直接复用的 Core 包: `model-core, prompts-core, delegate-core, hashline-core, comment-checker-core, skills-loader-core, mcp-client-core, omo-config-core, rules-engine, utils`。

## 3. 目标架构

```
packages/
├── agents-core/                 # 【新增】harness-neutral agent 定义(见 4.1)
├── omo-opencode2/               # 【新增】OpenCode2 adapter(本移植的主体)
│   ├── package.json             #   "exports": "./src/index.ts",deps 用真实版本号
│   └── src/
│       ├── index.ts             #   export default Plugin.define({ id: "omo", setup })
│       ├── agents/              #   agent.transform 注册 11 agents + categories
│       ├── orchestration/       #   task 工具、后台引擎、续聊
│       ├── hooks/               #   守卫 hooks + keyword-detector + goal/ulw-loop 续跑
│       ├── tools/               #   goal 三件套、background_*、hashline edit、look_at、session_*
│       ├── skills/              #   skill.transform 注册
│       └── config/              #   omo-config-core 接入 + ctx.options 合并
├── omo-opencode/                # v1 adapter,不动(仅 4.1 的抽取会让它 re-export)
├── omo-codex/                   # ulw-loop 引擎来源,不动
└── model-core / prompts-core / delegate-core / ...   # 直接复用
```

入口骨架:

```ts
import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "omo",
  setup: async (ctx) => {
    const config = await loadOmoConfig(ctx)          // omo-config-core + ctx.options
    const models = await resolveAllAgentModels(ctx, config)  // model-core over ctx.catalog
    await registerAgents(ctx, models, config)        // ctx.agent.transform(upsert × N)
    await registerCategories(ctx, models, config)    // categories 作为 subagent 注册
    await registerTools(ctx, config)                 // ctx.tool.transform(draft.add × N)
    await registerHooks(ctx, config)                 // tool.hook / session.hook("context") / event.subscribe
    await registerSkills(ctx, config)                // ctx.skill.transform
    return () => disposeAll()                        // 后台任务/订阅清理
  },
})
```

## 4. v1 -> v2 API 映射总表

| v1(omo-opencode) | v2(omo-opencode2) | 说明 |
|---|---|---|
| `config` hook 改写 `config.agent` | `ctx.agent.transform` 逐个 `update`(upsert) | v2 内建 build/plan/explore 等已存在;omo 覆盖 + 新增 |
| `config.default_agent = "sisyphus"` | `draft.default("sisyphus")` | |
| `AgentConfig.prompt` | `Agent.Info.system` | |
| `AgentConfig.model`/`variant` | `Agent.Info.model = {id, providerID, variant}` | |
| `AgentConfig.temperature/topP/maxTokens/thinking/reasoningEffort` | `Agent.Info.request.body` / `request.settings`;或 catalog variant | 静态每 agent 参数 |
| `AgentConfig.permission` map | `permissions: [{action, resource, effect}]` ruleset | 表达力更强(resource glob);`permission-compat.ts` 逻辑照搬 |
| `config.tools` 全局开关 + per-agent 布尔 | ruleset deny 规则 + context hook 删 `event.tools[x]` | 动态收工具用 context hook |
| `tool` hook 注册工具 | `ctx.tool.transform(draft.add)` | omo 工具一律 `codemode: false` |
| `tool.execute.before` | `ctx.tool.hook("execute.before")`(input 可变) | write-guard / comment-checker / prometheus-md-only / delegate 参数改写 |
| `tool.execute.after` | `ctx.tool.hook("execute.after")`(result 可变,已核实) | hashline read-enhancer / delegate-task-retry / empty-response 检测 |
| `chat.message` | `ctx.session.hook("context")`(检查 messages 尾部新用户消息) | keyword-detector |
| `experimental.chat.system.transform` | 同上,改 `system` 数组 | default_mode.ultrawork、sisyphus 运行时 prompt 重烘焙 |
| `experimental.chat.messages.transform` | 同上,改 `messages` 数组 | tool-pair 修复、context-injector |
| `chat.params` | 静态: agent `request.body`;动态: `ctx.aisdk.hook` | |
| `chat.headers` | agent `request.headers`(静态);`http.request` hook(仅 native) | Copilot x-initiator |
| `event` | `ctx.event.subscribe()` | 全部生命周期 |
| `experimental.session.compacting` | 无直接对应;`session.compaction.started/ended` 事件 + 事后 `synthetic` 重注入 | 见风险 R5 |
| `client.session.create/promptAsync/messages/abort` | `ctx.session.create/prompt/interrupt` + 事件流读输出 | 编排重写,见第 6 章 |
| `dispatchInternalPrompt`(prompt-async-gate) | `ctx.session.synthetic({delivery: "queue"})` | **prompt-async-gate 整体退役** |
| 内置 MCP 塞进 `config.mcp` | 安装器写 `opencode.json` 的 `mcp.servers` | 见 5.G |
| builtin-skills 机制 | `ctx.skill.transform(draft.source)` | directory/embedded 两种source |
| builtin-commands | `ctx.command.transform(draft.update)`(upsert) | |
| omo.json 配置链 | 不变,`omo-config-core` 直接复用 + `ctx.options` 覆盖层 | harness 块决策见 5.I |

## 5. 模块详细设计

### 5.A Agents 注册

1. **抽取 `packages/agents-core/`**(本移植唯一触碰现有代码的地方,遵循 ROADMAP "纯移动 + re-export + 测试保持绿"):
   - 移入: sisyphus 10 个变体(`agents/sisyphus/*.ts`)、hephaestus(`agents/hephaestus/*.ts`)、oracle、librarian、explore、metis、momus、multimodal-looker、sisyphus-junior 的 prompt builder(纯字符串函数,不含 v1 `AgentConfig` 类型)、`dynamic-agent-prompt-builder.ts`、模型家族判定(`isGptModel` 等,agents/types.ts 里的纯函数部分)。
   - 数据化: 每个 agent 的 `{ description, mode, 默认参数(temperature 等), 权限模板 }` 导出为纯数据,不含 harness 类型。
   - v1 adapter 侧: 原文件改为 `export * from "@oh-my-opencode/agents-core/..."`;`AgentFactory` 留在 v1 侧做类型适配。
2. **注册**: 单个 `ctx.agent.transform` 回调里按序 upsert 11 个 agent(顺序即 Map 插入序,尽力而为);`draft.default(config.default_agent ?? "sisyphus")`;`draft.update("build", a => { a.mode = "subagent"; a.hidden = true })` 复刻 v1 的 build 降级。
3. **模型解析**: `model-core.resolveModelPipeline()` 照旧;`ProviderCache` 实现为 v2 数据源——setup 时用 `ctx.catalog.transform(draft => { snapshot = { providers: draft.provider.list(), models: ... } })` 抓一次快照(同步 draft,无 v1 的 config 阶段死锁问题),模型可用性变化时 `ctx.agent.reload()`。
4. **权限映射**: v1 `permission: { write: "deny", task: "deny" }` → v2 ruleset 追加 `{action:"write", resource:"*", effect:"deny"}` 等;v2 原生 subagent 派发前会做 `permission.assert({action:"subagent", resources:[agent.id]})`,omo agents 的 ruleset 不要误伤 `subagent` action。
5. **categories**: 每个启用的 category 注册为一个 subagent agent(`draft.update("deep", ...)` 或直接以 category 名),`model` 填解析结果,`description` 写清用途,`system` = sisyphus-junior prompt + category `promptAppend`。这样**原生 subagent 工具就能直接按 category 派发**(见第 6 章分层)。
6. **动态 prompt**: sisyphus 的"缝合 live agents/categories/skills 列表"照旧——数据源换成 transform 内的 `draft.list()` 和 `ctx.skill.list()`;运行时按模型家族重烘焙用 context hook(`event.system` 数组改写)。

### 5.B 编排

见第 6 章专章。

### 5.C Goal

- **状态**: 沿用 `.omo/goal/{encodeURIComponent(sessionID)}.json` 文件方案(`hooks/goal/store.ts` 是纯 fs 逻辑,抽平移)。TUI mirror(`.omo/ulw-loop/{sessionID}/goals.json`)是 v1 sidebar 的输入,**不移植**。
- **工具**: `create_goal`/`update_goal`/`get_goal` 经 `tool.transform` 注册,`codemode: false`;schema 直接只留 `objective`(天然满足 ulw-loop 的预算守卫语义,Codex 侧那个 PreToolUse 守卫在 v2 不需要)。
- **`/goal` 命令**: `ctx.command.transform(draft.update("goal", ...))`,template 指示模型调用 goal 工具。
- **idle 续跑**(替代 v1 的 event+dispatchInternalPrompt):
  ```ts
  const events = ctx.event.subscribe()
  // for await: 若 event.type === "session.idle" 且 goal.active 且非 inFlight:
  //   ctx.session.synthetic({ sessionID, text: buildContinuationPrompt(goal), delivery: "queue" })
  ```
  `synthetic` 是 durable 受理,配合进程内 `inFlight: Set<sessionID>` 防重即可——v1 整套 prompt-async-gate(预约/持有/去重)在 v2 不需要。
- `session.deleted` → 删 goal 文件。
- `default_mode.goal`: context hook 检测主会话首条真实用户消息 → 自动建 goal(对应 v1 `loop-commands.ts` 的行为)。
- 配置: `goal.enabled`(默认 false)、`goal.auto_start` 沿用 omo.json schema。

### 5.D ulw-loop

引擎(`packages/omo-codex/plugin/components/ulw-loop/` 的 CLI)是独立 Node 程序、状态全在文件,**作为外部 CLI 复用**,不重写。三个 Codex hook 的 v2 映射:

| Codex hook | v2 实现 |
|---|---|
| `UserPromptSubmit`(ultrawork 指令注入 + `ulw-loop steer:` 解析) | keyword-detector 的 context hook(5.E);steering 指令在同一 hook 里检测并调 CLI `steer` |
| `PreToolUse` create_goal 预算守卫 | 不需要(omo 的 create_goal schema 本就 objective-only) |
| `Stop`(block + resume 指令) | `session.idle` 事件 → 跑 `omo-agent-toolkit ulw-loop status --json` → 存在 pending/in_progress goal 且未聚合完成 → `synthetic({delivery:"queue", text: resume指令})` 让 agent 继续 criteria → checkpoint;**two-strike 防卡死**(ledger 行数不变计一strike,2 次后写 `.stuck` 并停止注入)逻辑从 `stop-resume-hook.ts` 移植到 idle 处理器 |

- checkpoint 自动推进: agent 经 bash 跑 `ulw-loop checkpoint`,CLI 打印下一 goal 指令(现有机制,harness 无关)。
- skills 注册: `ulw-loop`/`ultrawork`/`ulw-plan`/`ulw-research` 四个 SKILL.md 从 `packages/shared-skills/skills/` 以 `{type:"directory", path}` 注册(发布包内打包,路径相对插件包解析);ultrawork 指令注入保持"短指针 <4096B + 引导读 skill"的截断安全设计(参照 codex 侧 skill-pointer)。
- 证据目录约定不变: `.omo/evidence/ulw/<session>/<goalId>/a<attempt>`。
- CLI 可达性: 安装器把 `omo-agent-toolkit` 放到 PATH(现有机制);v2 插件经 bash 调用,与 codex 版一致。

### 5.E keyword-detector / ultrawork

- **检测逻辑原样搬**(纯 TS): `KEYWORD_DETECTORS` 正则、guard 链(跳过 synthetic/系统指令/斜杠命令/非 omo agent/代码块剥离)、组合抑制、planner 过滤、`filterAlreadyInjectedKeywords` 防重。
- **hook 点**: `ctx.session.hook("context")`。识别"新用户消息"的方法: 检查 `event.messages` 尾部连续 user 消息,取最后一条的文本做检测(该 hook 每次模型调用都触发,检测必须幂等——防重逻辑正好覆盖)。
- **注入位置变化**: v1 是改写首个用户 text part;v2 改为 **push 到 `event.system` 数组**(`<ultrawork-mode>...</ultrawork-mode>`),更干净且不影响用户消息原文。ultrawork 的模型家族路由(planner/gpt/gemini/glm/default)照旧,prompt 来自 `@oh-my-opencode/prompts-core`。
- **`default_mode.ultrawork`**: 同一 context hook,无条件注入(以 `<ultrawork-mode>` 存在性判重;compaction 后 system 重建,天然安全——v1 需要专门 hook 保证的事在 v2 免费得到)。
- **`team` 关键词不迁移**(team-mode 不在范围);保留 `ultrawork`/`hyperplan`/`hyperplan-ultrawork`(hyperplan 是 prompt+skill 驱动,不依赖 team-mode 运行时——若发现 skill 内部引用 team 工具,降级为仅注入 ultrawork)。
- **toast 副作用**: v2 有 `tui.toast.show` 事件类型但插件 ctx 无发布通道——**砍掉 toast**,注入即全部。
- **ultrawork 模型覆盖**(`agents.<name>.ultrawork`): v2 插件 SessionDomain 不含 `session.switchModel`,无 per-message 换模型 API——**初版砍掉**,列入缺口 R6。

### 5.F 守卫 hooks

全部低risk直接映射:

| hook | v2 落点 | 核心包 |
|---|---|---|
| write-existing-file-guard | `tool.hook("execute.before")`(对 write/edit 断言已读) | adapter 内小状态机 |
| comment-checker | `execute.before` + `execute.after` | `comment-checker-core`(spawn 二进制,DI 可注入) |
| hashline read-enhancer | `execute.after` 改写 `result`(已验证可变) | `hashline-core` |
| hashline `edit` 工具 | `tool.transform` 注册 | `hashline-core`;注意与 v2 内建 `edit` 的命名关系(见风险 R7) |
| prometheus-md-only | `execute.before`(agent === "prometheus" 时限制 .md) | adapter |
| delegate-task-retry / empty-task-response-detector | `execute.after`(对 omo `task` 工具输出检测+追加指导) | `delegate-core` |
| tool-pair 修复 / context-injector | context hook 改 `messages` | adapter |
| rules-injector | context hook 注入 system(或改用 `ctx.reference.transform` 注册 `.omo/rules/` 为 reference source——更原生,待 spike 比较) | `rules-engine` |

### 5.G MCP(含 codegraph)

插件无 MCP API,**由安装器落配置**。给 fork 的 CLI 加 `--platform=opencode2`:

```jsonc
// opencode.json(c) 写入结果
{
  "plugins": ["oh-my-opencode2"],          // 或 { "package": "...", "options": {...} }
  "mcp": {
    "servers": {
      "codegraph": { "type": "local", "command": ["<resolved codegraph>", "serve", "--mcp"], "codemode": false },
      "lsp":       { "type": "local", "command": ["node", "<pkg>/lsp-daemon/dist/cli.js", "mcp"], "codemode": false,
                     "environment": { "LSP_TOOLS_MCP_PROJECT_CONFIG": "...", ... } },
      "websearch": { "type": "remote", "url": "https://mcp.exa.ai/mcp" },
      "context7":  { "type": "remote", "url": "https://mcp.context7.com/mcp" },
      "grep_app":  { "type": "remote", "url": "https://mcp.grep.app" }
    }
  }
}
```

- codegraph 二进制解析(`resolveCodegraphCommand`: bundled npm → `~/.omo/codegraph` → PATH)和 lsp-daemon 路径解析(`ancestor-cli-resolver` + bootstrap)逻辑在 `packages/utils`,原样复用——安装时解析一次写成绝对路径,运行期不再动态解析。
- `codemode: false` 必须显式写(默认 true 会把工具收进 CodeMode)。
- `disabled_mcps` 配置语义映射为安装器不写/写 `disabled: true`。
- 优化项(可选,后置): websearch 改用 `ctx.websearch.transform` 注册原生搜索 provider,替代 MCP。

### 5.H Skills / Commands

- Skills: `ctx.skill.transform(d => d.source({ type: "directory", path: <pkg>/skills }))` 注册 shared-skills;个别必须随包的 skill 可用 `{ type: "embedded", skill }` 内嵌。
- Commands: omo 内建命令(`goal`、`stop-continuation`、`start-work` 等需要的子集)经 `command.transform` upsert;`disabled_commands` 配置在注册前过滤。
- v2 原生已有 skill 工具体系和 `session.skill` 激活 API,omo v1 的 `skill`/`skill_mcp` 工具**不移植**。

### 5.I 配置

- `omo-config-core` 原样复用: 用户层 `~/.omo/omo.json[c]` + 项目层向上查找 + profiles。
- **决策点**: harness 块新增 `[opencode2]` 还是复用 `[opencode]`?建议**新增 `[opencode2]`**,与 v1 配置互不干扰(v2 功能子集不同);迁移向导后置。
- `ctx.options`(opencode.json 插件条目的 options)作为最高优先级覆盖层叠加。
- 不复用 v1 的 6 阶段 config pipeline(那是改 v1 config 对象的);v2 侧配置装配都在各 transform 回调里。

## 6. Subagent 混合策略(原生优先,omo 补齐)

### 6.1 分工表

| 能力 | v2 原生 `subagent` | omo `task`(v2 重写) | 说明 |
|---|---|---|---|
| 按名派发 subagent agent | ✅ | ✅ | omo agents 注册为 `mode:"subagent"` 即被原生工具自动列入描述 |
| foreground 同步返回输出 | ✅(内部 messages API) | ✅(事件流累积) | 原生实现更简;omo 保留是为了一致的附加能力 |
| background + 完成自动通知父会话 | ✅(synthetic 注入) | ✅(自有 registry + synthetic) | 原生已覆盖基本场景 |
| 深度限制 | ✅(`experimental.subagent_depth`,默认 1) | 遵循 | omo 不绕过 |
| category 路由 + fallback 链 | ❌ | ✅ | categories 同时注册为 subagent agents(5.A.5),原生也能按名派发;`task` 的 `category` 参数保留动态解析(promptAppend/max_prompt_tokens/运行时再解析) |
| `task_id` 续聊(向已有子会话追加 prompt) | ❌(每次新建) | ✅ | `ctx.session.prompt` 打到已有 child sessionID |
| `load_skills` | ❌ | ✅ | v2 `prompt` 原生支持 `skills` 附件;或拼入 prompt 文本(与 v1 行为一致,推荐后者) |
| 并发上限(5/provider+model) | ❌ | ✅ | 纯逻辑,从 background-agent/concurrency.ts 搬 |
| 运行时失败回退(429/503 换链上下一个模型重试) | ❌ | ✅ | 监听 `session.execution.failed`/`session.retry.scheduled`,interrupt 后以链上下一模型重建会话 |
| 后台任务 registry(list/output/cancel) | ❌ | ✅ | `background_output`/`background_cancel` 工具保留,omo task id ↔ sessionID 映射插件内维护 |
| `call_omo_agent`(explore/librarian 直调) | 原生可覆盖 | 合并 | **v2 删除该工具**,由 `task(subagent_type=...)` 或原生 subagent 承担;文档记录迁移 |

### 6.2 互动规则(避免双入口混乱)

- v1 里 omo 把内建 task 工具 permission deny 掉以强制走自家 `task`。v2 **反其道而行**: 原生 `subagent` 保持可用(简单派发走原生,享受官方维护),omo `task` 的描述明确写"需要 category 路由 / 后台并发管理 / 续聊 / load_skills 时使用"。
- omo agents 的 permissions 不再 deny `subagent` action;只有编排模型(sisyphus/atlas 等 primary)的 prompt 里写明分工。
- 风险: 模型混用两个入口导致统计/并发控制不一致——可接受,并发上限只管 omo task 发起的;原生路径由 v2 自己管。若实测混乱,再用 context hook 对特定 agent 删掉 `event.tools.subagent`。

### 6.3 omo `task` 工具的 v2 实现要点

```
execute(input, toolCtx):
  1. 路由: category? → model-core 解析(model/promptAppend/参数); subagent_type? → agent 直选
  2. 并发: acquire(`${providerID}/${modelID}` 槽位, 满则 FIFO 排队)
  3. child = ctx.session.create({ agent, model, title: description })   // 无 parentID,插件侧 registry 记录 parent
  4. 订阅事件流(插件级单订阅,按 sessionID 分发)
  5. ctx.session.prompt({ sessionID: child.id, text: 组装后的 prompt(含 load_skills 内容) })  // 自动执行
  6a. sync: 等待 child 的 session.execution.succeeded/failed/interrupted(超时/中断 → ctx.session.interrupt)
      → 聚合该会话的 session.text.ended 文本(无文本时回退 session.reasoning.ended,spike 证据 F3)→ 返回(空输出 → empty-response 指导)
  6b. background: 注册 task(id/状态/父 sessionID) → 立即返回;
      完成时 ctx.session.synthetic({ sessionID: parent, delivery: "queue", text: 完成通知(含结果摘要) })
  7. task_id 续聊: 直接 prompt 到已存在 child,重复 5-6
  8. 失败回退: execution.failed 且错误匹配 provider 错误模式 → 取 fallback 链下一模型重建会话重试(delegate-core 的 9 个重试模式)
```

## 7. 新增/改动清单

| 动作 | 位置 | 内容 |
|---|---|---|
| 新增 | `packages/agents-core/` | 7 个 prompt 家族 + agent 定义数据 + 模型家族判定(从 omo-opencode 纯移动) |
| 新增 | `packages/omo-opencode2/` | v2 adapter 主体 |
| 修改 | `packages/omo-opencode/src/agents/*.ts` | 改为 re-export agents-core(纯移动,行为不变,`bun test` 守绿) |
| 修改 | `packages/omo-opencode/src/cli/` | `install --platform=opencode2`: 写 plugins 条目 + mcp.servers + 可选 agents 覆盖 |
| 复用 | `packages/omo-codex/plugin/components/ulw-loop/` | ulw-loop CLI 引擎不动,经 PATH 调用 |
| 新增 | `.agents/skills/opencode2-qa/`(或扩展 opencode-qa) | 面向 `opencode2` CLI/API 的隔离 QA 规程(见第 9 章) |

## 8. 风险与缺口(均已实锤)

| # | 风险 | 证据 | 对策 |
|---|---|---|---|
| R1 | 插件 SessionDomain 无 `messages` 读取;文档承诺的 `wait` 未在类型中 | `packages/plugin/src/promise/session.ts` | ✅ spike 已验证事件流读取可行(`text.ended` + `reasoning.ended` 兜底,durable 有序);子 agent 可能只产 reasoning 无文本,必须保留空输出检测 |
| R2 | 公开 `session.create` 不支持 `parentID`,TUI 无父子嵌套 | `packages/core/src/plugin/promise.ts:271-292` | 插件内 registry 记录父子;标题前缀;不阻塞功能 |
| R3 | `Agent.Info` 无 `order` 字段,agent 排序 = 注册插入序,TUI 展示未验证 | `packages/schema/src/agent.ts` | `default("sisyphus")` 保默认;排序实测后决定是否需要变通 |
| R4 | `http.request/response` hook 仅 native 模型路径 | v2 文档明示 | Copilot 等 header 用 agent `request.headers` 静态注入 |
| R5 | 无 compaction transform hook | API 面核查 | `session.compaction.*` 事件 + 事后 `synthetic` 重注入 todo/checkpoint;重新设计,接受行为差异 |
| R6 | 无 per-message 模型切换 API(ultrawork 模型覆盖、model-fallback 主动切换) | SessionDomain 无 switchModel | 初版砍掉 ultrawork override;fallback 只做"失败后重建会话"的被动态 |
| R7 | hashline 工具与 v2 内建 `edit` 撞名 | v2 `packages/core/src/tool/` 有内建 edit | 注册为独立名(如 `hashline_edit`)或用 context hook 改名/替换内建 edit 的描述;spike 验证 |
| R8 | v2 API beta,会持续 breaking | 官方声明 | 钉 `@opencode-ai/plugin` 具体版本;跟踪上游 `v2` 分支;适配层集中在 adapter 包 |
| R9 | npm 发布时 workspace 依赖需真实版本 | 仓库现状 | 初版走本地路径/`.opencode/plugins/` 分发;发布时参照 publish.yml 的版本改写脚本 |
| R10 | v2 自身功能完整度(compaction/summary agent 等仍在开发中) | v2 分支 WIP 状态 | 每个 Phase 先做真实会话验证再铺开 |
| R11 | Windows 上 npm 安装的 `opencode2` 启动器 exe 不可运行;需要后台服务的子命令(plugin list / debug agents / mcp list)在本机超时 | spike 证据 F1/F2 | 直接调用平台包内二进制;QA 统一走 `run --standalone`;`api --standalone` 的 location 状态为空,不能用作注册证明 |
| R12 | `execute.after` 的 `result.content` 到达时是 `Content[]` 数组而非字符串 | spike 证据 F4 | 工具结果改写统一按数组形态处理(hashline read-enhancer 移植时注意) |
| R13 | v2 文档与实现漂移(如文档 `tools.add(name, def)` vs 实际 `draft.add({name,...})`) | spike 证据 F6 | 签名一律以 `@opencode-ai/plugin` 发布的 .d.ts 为准,不照抄文档 |
| R14 | v2 catalog 是全量 models.dev 目录(实测 6215 models / ~200 providers),不区分已认证可用 provider;model-core 据此把 agent 解析到链上首选但本机未认证的模型,子 agent 运行期 `Model unavailable`。v1 只解析 connected providers,无此问题 | Phase 1 证据 `20260811-opencode2-phase1`(trace `omo.catalog.snapshot` availableModels=6215;run-subagent `Model unavailable: openai/gpt-5.6-sol`) | 已发布的 `@opencode-ai/plugin@0.0.0-next-17055` Promise API 在 catalog/provider/client 上无 per-provider 认证信号(仅 `integration.connection.active`,按 integration id 而非 provider)。在 v2 暴露 connectivity API 前,auth-aware 过滤后置;完整配置的机器上解析正确。另一发现: catalog 在 setup 时为空、`catalog.updated` 后才填充 —— 解析必须在 `agent.transform` 回调内读最新 snapshot(已在 P1 修复) |

## 9. 分阶段实施计划

### Phase 0 — Spike(✅ 已完成 2026-08-10,PASS=15/15,证据 `.omo/evidence/20260810-opencode2-spike/`)

新建 `packages/omo-opencode2` 最小骨架,真实 opencode2 环境验证 6 件事,全部留证据:

1. `agent.transform` upsert 注册 agent → `opencode2 api get /api/agent` 可见、`default` 生效、子会话可跑;
2. `session.create` → `prompt`(默认 resume 自动执行)→ 事件流收到 `session.execution.succeeded` → `session.text.ended` 聚合出完整输出;
3. `tool.transform` 注册工具 + `execute.before` 改 input + `execute.after` 改 result 均生效;
4. context hook 改 `system`/`messages`/删 `tools` 生效;
5. `session.synthetic({delivery:"queue"})` 注入父会话被消费;
6. 安装器手写一份 `opencode.json` 的 `mcp.servers`(codegraph stdio + `codemode:false`)→ 工具出现在模型可用工具里。

### Phase 1 — agents-core 抽取 + 11 agents + categories(✅ 已完成 2026-08-11,证据 `.omo/evidence/20260811-opencode2-phase1/`)

纯移动抽取(v1 测试守绿)→ v2 注册全部 agents/categories → model-core 接 catalog 快照。验收: 各 agent 在真实会话中以其模型/权限/prompt 运行。

完成要点: agents-core 抽取(7 个 prompt 家族纯移动 + re-export,v1 agents 套件 371/0,全包 typecheck 绿); omo-opencode2 注册 4 primaries + 7 subagents + 8 categories,default=sisyphus,build 降级,QA 26/0。修复了 catalog setup 时为空 + 注册摘要为空两个时序 bug(见 P1-F1)。遗留: catalog 是全量 models.dev 目录不分认证状态,子 agent 可能解析到未认证模型(见 R14)。

### Phase 2 — 编排(✅ 已完成 2026-08-11,证据 `.omo/evidence/20260811-opencode2-phase2/`)

task 工具(6.3 全链路)+ 后台引擎 + 并发上限 + 续聊 + background_output/cancel。验收: sync/background/continuation 三条路径真实跑通,事件证据齐全。

完成要点: `orchestration/` 新增 task-registry / concurrency(默认 5 FIFO)/ task-engine(事件泵 → 任务记录 → 后台完成 synthetic 通知)/ child-session(create→prompt→聚合;失败沿 fallback 链重试一次;task_id 续聊复用同一子会话)/ task-tool / background-tools。task 工具带显式 `model` 覆盖(缓解 R14)。真实 opencode2 QA 11/0:sync 返回子输出、background 返回 task_id + 完成通知 + background_output 可取、continuation 同子会话二次执行。单测 20/0。

### Phase 3 — 守卫 hooks + hashline

write-guard/comment-checker/hashline/prometheus-md-only/delegate-retry。验收: 每个 hook 一个正反用例。

### Phase 4 — keyword-detector + ultrawork + goal

context hook 注入(幂等)+ goal 三件套 + `/goal` + idle 续跑(synthetic)。验收: "ulw" 触发 ultrawork 注入;goal idle 续跑不多发不少发。

### Phase 5 — ulw-loop

CLI 接入 + stop→idle 续跑 + two-strike + 4 个 skills 注册。验收: 一个完整 create-goals → 执行 → checkpoint → complete 循环。

### Phase 6 — MCP + 安装器 + 配置链

`install --platform=opencode2` 三件套(plugins/mcp/agents)+ omo-config-core 接入(`[opencode2]` 块 + ctx.options)。

### Phase 7 — 收尾

文档(README/docs)、`bun run typecheck`、两个仓库测试全绿、QA 证据归档。

## 10. QA 与证据规程

沿用仓库强制 QA 文化(根 AGENTS.md),面向 opencode2 适配:

- **隔离**: 独立 XDG_* 目录 + 独立配置目录,绝不污染真实 `~/.config/opencode`;参照 `script/agent/qa-sandbox.sh` 的约定。
- **插件加载证明**: `opencode2 api get /api/plugin` 含 `omo`;失败时查 server 日志(一个插件失败不影响其他插件)。
- **行为证明**: `opencode2 run --format json`(或等效非交互命令)+ 事件流断言(参照 `opencode-qa` 技能的 sse-hook-probe 思路,面向 v2 的 `/api` 与事件订阅重写探针)。
- **证据归档**: `.omo/evidence/<YYYYMMDD>-opencode2-<slug>/`,记录 WHAT TESTED / WHAT OBSERVED / WHY ENOUGH / WHAT OMITTED。
- 新增 `opencode2-qa` 技能(或扩展 `opencode-qa`),把上述固化。

## 11. 版本钉住与上游跟踪

- `package.json` 依赖钉死: `@opencode-ai/plugin` 用确切 next 版本号(不用 `next` tag 浮动);CI 加"升级版本 → 跑 spike 六项"的规程。
- 每周跟踪 anomalyco/opencode `v2` 分支的 `packages/plugin/`、`packages/core/src/plugin/`、`packages/core/src/tool/plugin/subagent.ts` 变更。
- omo 侧: fork 定期同步 code-yeongyu/oh-my-openagent `dev`(分层重构仍在进行,Core 包的抽取边界可能继续移动——agents-core 的抽取越早做,后续冲突越小)。

---

### 附: 本文档涉及的关键源码位置速查

| 主题 | 位置 |
|---|---|
| v2 插件 Promise 桥(公开面的真相) | anomalyco/opencode@v2 `packages/core/src/plugin/promise.ts` |
| v2 原生 subagent 工具(参考实现) | 同上 `packages/core/src/tool/plugin/subagent.ts` |
| v2 agent transform upsert 实现 | 同上 `packages/core/src/agent.ts` |
| v2 Agent.Info schema | 同上 `packages/schema/src/agent.ts` |
| v2 context hook 触发点(可变 system/messages/tools) | 同上 `packages/core/src/session/model-request.ts:199-217` |
| v2 tool hooks(execute.after result 可变) | 同上 `packages/core/src/tool.ts:85-137` |
| v2 session prompt 自动执行 | 同上 `packages/core/src/session.ts:603` |
| v2 MCP 配置 schema | 同上 `packages/schema/src/config/mcp.ts` + `packages/www/content/docs/(Configure)/mcp-servers.mdx` |
| omo agents 注册表 | 本仓库 `packages/omo-opencode/src/agents/builtin-agents.ts` |
| omo 模型要求/回退链 | 本仓库 `packages/model-core/src/agent-model-requirements.ts`、`category-model-requirements.ts` |
| omo goal 实现 | 本仓库 `packages/omo-opencode/src/hooks/goal/` |
| omo ulw-loop 引擎 | 本仓库 `packages/omo-codex/plugin/components/ulw-loop/` |
| omo keyword-detector | 本仓库 `packages/omo-opencode/src/hooks/keyword-detector/` |
| omo 后台引擎 | 本仓库 `packages/omo-opencode/src/features/background-agent/` |
