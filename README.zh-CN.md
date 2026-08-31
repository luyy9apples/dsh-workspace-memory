# dsh-workspace-memory

> 为 DeepSeek Harness 提供持久、需用户确认的工作区 instruction 与项目记忆。

![DSH Bundle](https://img.shields.io/badge/DSH-Bundle-5b5bd6.svg)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19%20%7C%7C%20%3E%3D24-339933.svg)](package.json)

[English](README.md) | 简体中文

`dsh-workspace-memory` 让同一工作区中的多个会话共享两类持久上下文：

| 文件 | 适合保存的内容 |
|---|---|
| `AGENTS.md` | Agent 如何工作、写作、格式化、验证和使用工具的可复用规则 |
| `.dsh-memory.md` | 稳定的项目事实、决策、术语、约束与未决风险 |

它们都是工作区根目录下的普通 Markdown 文件。无需数据库、Embedding 或云端服务，内容仍然可以直接阅读、审查并纳入版本管理。

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

- **跨会话共享上下文**：新会话可以看到已有会话使用的工作区规则与项目决策。
- **指令与知识分开保存**：行为规则进入 `AGENTS.md`，项目知识进入 `.dsh-memory.md`。
- **不静默写入推断内容**：模型识别到持久意见后，会突出展示变更差异并询问用户。
- **每一步都读取最新内容**：两个文件会在每个获准模型步骤前重新读取，已有会话也能看到后续修改。
- **防止并发覆盖**：基于旧文件版本生成的提案，不能覆盖另一会话刚写入的新版本。
- **本地且透明**：没有网络请求、遥测、数据库或隐藏记忆存储。

## 快速体验：工作约定与项目记忆

在需要共享上下文的工作区中打开一个 DSH 会话。

### 1. 保存一条长期工作约定

输入：

> 以后在这个工作区改完文件后，请在回复末尾说明改了哪些内容、做了哪些验证；如果没法验证，也要说明原因。这个约定后续会话都要遵守。

这是一条需要反复执行的工作约定，适合写入 `AGENTS.md`。Agent 应当先整理出精确的修改方案，再由 DSH 展示简要理由和变更差异。选择 **Apply** 写入，选择 **Keep current** 则保持原文件不变。

### 2. 记录一项长期项目背景

接着输入：

> 项目目前以兼容旧版接口为优先，暂不为了采用新 API 引入破坏性改动。请把这项技术决策留给后续会话。

这是已经确定的项目背景，而不是每次都要执行的操作要求，适合写入 `.dsh-memory.md`。

### 3. 换一个会话检查结果

在同一个工作区目录中新建会话，然后询问：

> 这个工作区有哪些需要遵守的约定？项目上有哪些已经确定的决策？

新会话应当分别回答：

- `AGENTS.md` 中要求每次执行的工作约定；
- `.dsh-memory.md` 中需要长期保留的项目背景和决策。

拿不准应该保存到哪里时，可以这样判断：

| 判断方式 | 保存位置 |
|---|---|
| 以后处理其他任务时也必须照此执行吗？ | `AGENTS.md` |
| 这是后续工作需要了解的项目事实、决策、术语或限制吗？ | `.dsh-memory.md` |
| 只是这一次需要完成的具体任务吗？ | 不保存 |

例如，“提交前运行相关测试”是工作约定；“项目当前兼容 Node.js 22 和 24”是项目背景；“修好这个失败用例”只是当前任务，不应长期保存。

## 工作方式

```text
持久的用户意见
      |
      +-- 可复用的 Agent 行为 ----------> AGENTS.md
      |
      +-- 稳定的项目知识 ---------------> .dsh-memory.md
      |
      `-- 一次性要求或临时进度 ----------> 不保存

候选内容 -> 完整文件合并 -> 用户确认 -> 版本保护写入
```

每个获准模型步骤前，插件会注入两个文件的当前快照。可见内容没有变化时不会重复追加；空文件和已删除文件也会被明确表示，从而替代陈旧内容。

模型负责判断意见是否值得长期保留，以及应当归入哪个文件。发起提案前，Agent 会被要求通读完整 Markdown，把内容准确归入相关章节，整理受影响部分的重复表述，同时保留无关内容和既有结构。`workspace_memory` 工具负责强制写入边界：模型推断出的修改必须使用 `propose`，并且只有用户选择 **Apply** 后才会写入。写入时，文件版本还必须与确认前读取的版本一致。

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
