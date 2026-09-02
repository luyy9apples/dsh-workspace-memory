# dsh-workspace-memory

> 有意识地维护标准 `AGENTS.md`，经用户确认沉淀工作约定，并将项目事实分开保存。

![DSH Bundle](https://img.shields.io/badge/DSH-Bundle-5b5bd6.svg)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-339933.svg)](package.json)

[English](README.md) | 简体中文

DSH 已经把 `AGENTS.md` 作为标准的工作区指令来源。`dsh-workspace-memory` 补上维护闭环：当会话中形成可长期复用的工作约定时，模型可以把它准确整合进现有文档，展示精简 diff，并在用户确认后写入。

稳定的项目事实和决策则保存在 `.dsh-memory.md`，不与行为指令混在一起。这样可以让 `AGENTS.md` 保持聚焦，避免逐渐膨胀成包罗所有信息的记忆文件。

| 文件 | 适合保存的内容 |
|---|---|
| `AGENTS.md` | Agent 如何工作、写作、格式化、验证和使用工具的可复用规则 |
| `.dsh-memory.md` | Agent 需要了解、但不应当作为行为规则的稳定事实、决策、术语、约束与未决风险 |

它们都是工作区根目录下的普通 Markdown 文件。无需数据库、Embedding 或云端服务，内容仍然可以直接阅读、审查并纳入版本管理。

## 一分钟了解工作区共享记忆

演示展示了一套完整流程：把需要长期遵守的工作约定保存到 `AGENTS.md`，把稳定的项目决策记录到 `.dsh-memory.md`，随后在同一工作区打开新会话，验证它能够同时读取两类内容。模型推断出的更新都会先以精简 diff 展示，只有用户确认后才会写入。

![在多个 DSH 会话间共享工作区指令与记忆](https://raw.githubusercontent.com/luyy9apples/dsh-workspace-memory/main/docs/assets/workspace-memory-demo.gif)

安装后可以用下面三句话复现：

1. **工作区指令：**“以后在这个工作区改完文件后，请在回复末尾说明改了哪些内容、做了哪些验证。这个约定后续会话都要遵守。”
2. **项目记忆：**“项目目前以兼容旧版接口为优先，暂不为了采用新 API 引入破坏性改动。请把这项技术决策留给后续会话。”
3. **新会话验证：**“这个工作区有哪些需要遵守的约定？项目上有哪些已经确定的决策？”

需要 Agent 反复执行的规则进入 `AGENTS.md`；后续任务需要了解的稳定事实和决策进入 `.dsh-memory.md`。两者分开可以防止事实性上下文不断挤入并撑大指令文件；只针对当前任务的一次性要求不保存。

## 安装

需要 DeepSeek Harness `0.1.1-rc.2`，以及 Node.js `^22.19.0 || >=24.0.0`。

```sh
dsh plugin --profile web add dsh-workspace-memory
dsh --profile web
```

仅此两步。本包声明了 `dsh.bundle`，DSH 会自动把配置层加入 `web` profile，无需手工修改 profile 文件。安装或更新后，请重启已经运行的 profile。

```sh
# 更新
dsh plugin --profile web update dsh-workspace-memory@latest

# 卸载
dsh plugin --profile web remove dsh-workspace-memory
```

## 为什么使用它？

- **有意识地维护标准指令文件**：可复用的用户意见可以成为对现有 `AGENTS.md` 的精确、可审阅修改。
- **让 `AGENTS.md` 保持聚焦**：事实和决策进入 `.dsh-memory.md`，不作为行为指令不断累积。
- **并发会话保持一致**：已经打开的会话会在下一次模型步骤前重新读取最新工作区上下文。
- **不静默写入推断内容**：模型识别到持久意见后，会突出展示变更差异并询问用户。
- **陈旧修改不会覆盖新内容**：如果其他会话已经修改文件，基于旧版本生成的提案会被拒绝。
- **专用 Web 审阅界面**：DSH Web 会显示行号、增删配色并折叠未修改内容；其他客户端仍可使用 Markdown 降级界面。
- **遵循会话沙箱**：写入使用当前会话的 cwd 和权限策略，而不是 DSH 服务的启动目录。
- **本地且透明**：没有网络请求、遥测、数据库或隐藏记忆存储。

## 工作方式

```text
持久的用户意见
      |
      +-- 可复用的 Agent 行为 ----------> AGENTS.md
      |
      +-- 稳定的事实性项目上下文 -------> .dsh-memory.md
      |
      `-- 一次性要求或临时进度 ----------> 不保存

候选内容 -> 完整文件合并 -> 用户确认 -> 版本保护写入
```

每个获准模型步骤前，插件会注入两个文件的当前快照。可见内容没有变化时不会重复追加；空文件和已删除文件也会被明确表示，从而替代陈旧内容。刷新发生在每次模型步骤之前，并非实时广播；发生并发冲突时，插件会拒绝陈旧提案，而不是自动合并。

模型负责判断持久意见属于可复用的行为规则、事实性项目上下文，还是两者都不是。发起提案前，Agent 会被要求通读完整目标文档，把最小且语义完整的修改准确归入相关章节，整理受影响部分的重复表述，同时保留无关内容和既有结构。`workspace_memory` 工具负责强制写入边界：模型推断出的修改必须使用 `propose`，并且只有用户确认后才会写入。写入时，文件版本还必须与确认前读取的版本一致。

它与 DSH 标准 `agent-instructions` 加载器形成互补：原生插件负责发现并应用 `AGENTS.md`，`dsh-workspace-memory` 负责有意识地维护 cwd 层级的文件，并把事实性上下文保存在配套文件中。

npm Bundle 同时包含服务端与浏览器端。服务端保留完整候选文件并执行带版本保护的写入；Web 端只接收有长度限制的结构化修改片段，再通过 DSH 客户端模块系统渲染审阅卡片。因此，安装插件后无需重新构建 DSH Web 主程序。

这套机制可以改善会话连续性，但不能保证模型始终正确分类、记住或遵循每一条指令。

## 默认配置与自定义

Bundle 默认安装以下配置：

```yaml
memoryFile: .dsh-memory.md
instructionFile: AGENTS.md
suggestUpdates: true
maxBytes: 32768
```

如需覆盖，可以在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中添加更晚的配置行。DSH 会整体替换 `config`，因此需要重述全部字段：

```yaml
- id: workspace-memory
  config:
    memoryFile: .dsh-memory.md
    instructionFile: AGENTS.md
    suggestUpdates: false
    maxBytes: 65536
```

两个文件名必须不同，并且只能是不含目录分隔符的同目录文件名。`maxBytes` 分别限制每个完整文件以及提案理由。已有文件必须是普通 UTF-8 文件；路径最后一段为符号链接时会被拒绝。

## 安全边界

| 边界 | 行为 |
|---|---|
| 存储范围 | 仅会话精确 cwd 下配置的两个文件 |
| 模型推断的修改 | 必须经过交互确认 |
| 并发修改 | 拒绝陈旧的全文件替换 |
| 沙箱边界 | 严格使用当前会话的权限策略和 cwd；只读模式仍然禁止写入 |
| 提案失败或被拒绝 | Agent 不得改用其他写入工具绕过 `workspace_memory` |
| 符号链接 | 拒绝路径最后一段为符号链接 |
| 网络与遥测 | 无 |
| 数据库与 Embedding | 无 |

完整的权限和写入安全模型见 [SECURITY.md](SECURITY.md)。

## 兼容性与限制

| 环境 | 状态 |
|---|---|
| DSH Web `0.1.1-rc.2` | 已测试 |
| Windows x64 | 已测试 |
| Ubuntu、Node.js 22 与 24 | CI 目标 |
| macOS | 尚未验证 |
| Headless profile | 建议设置 `suggestUpdates: false`；通常没有交互确认提供方 |

- 工作区身份是会话的精确 cwd；父目录、兄弟目录和子目录不会自动共享同一记忆文件。
- 本插件只同步 cwd 根部的 `AGENTS.md`。全局、祖先和嵌套 instruction 的发现仍由 DSH 标准 agent-instructions 插件负责。
- 分类由模型完成，可能漏判或误判。确认机制可以防止静默写入推断内容，但不能保证分类或指令遵循始终正确。
- 全文件替换是有意设计。调用方负责合并完整内容；插件拒绝陈旧写入，而不会尝试不安全的自动合并。

## 故障排查

### Profile 中没有出现 Bundle

```sh
dsh --profile web --dump-config
```

确认输出中包含 `# == dsh-workspace-memory` 配置层和 `id: workspace-memory`。如果二者都存在，请重启 profile。

### 没有出现更新询问

检查 `suggestUpdates` 是否为 `true`，并确认意见是持久规则或稳定知识，而非一次性任务。进行确定性测试时，可以明确说明该规则或决策需要适用于未来会话。

### 确认后写入失败

可能有其他会话在确认窗口打开期间修改了文件。请读取当前内容、重新合并候选修改，然后提交新的提案。

## 开发

```sh
pnpm install
pnpm run verify
pnpm pack
```

把本地源码安装进 DSH：

```sh
pnpm run build
dsh plugin --profile web add "link:/absolute/path/to/dsh-workspace-memory"
dsh --profile web
```

版本记录见 [CHANGELOG.md](CHANGELOG.md)。欢迎贡献代码，以及提交带有明确复现步骤的问题报告。
