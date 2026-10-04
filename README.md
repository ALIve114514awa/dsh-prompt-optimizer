# DeepSeek Harness 提示词优化插件

**版本 0.1.3**。将模糊需求改写为清晰的提示词，支持 Harness 当前模型与 Codex，可先提问澄清，再预览和编辑结果。

Web UI 和桌面端的入口位于**左侧边栏底部、“上下文洞察”上方**；TUI 使用 `/prompt-optimize`。结果由用户确认后填入当前对话的草稿，聊天消息始终由用户自行发送。

实际验收范围与未验证事项见 [验收记录](docs/validation.md)。

## 使用

1. 选择一个聊天会话，打开“优化提示词”。在独立页面填写需求，或点击“带入输入框草稿”。
2. 选择 Harness AI / Codex，以及智能优化、扩写或精简。
3. 点击“澄清需求”，回答或跳过最多三个问题，再明确点击生成；也可以直接生成。
4. 在预览中编辑或复制结果，点击“应用到输入框”填回当前对话，再自行发送。

上下文默认关闭。手动开启后，只附带最近一轮**已结束**的用户输入和 AI 回复，不使用正在生成的回合，也不自动附带工作区文件或附件。

生成期间可以取消。同一会话的问答和预览可保留；点击返回会取消当前请求。草稿、草稿版本、会话或引用附件变化后，旧结果不能覆盖新草稿，需要重新确认。

### TUI 快捷键

| 按键 | 操作 |
| --- | --- |
| `Ctrl+G` | 澄清需求，或根据已填答案生成；空答案视为跳过 |
| `Ctrl+R` | 直接生成 |
| `Ctrl+N/P` | 切换输入栏 |
| `Tab` | 切换优化方式 |
| `Ctrl+B` | 切换 AI 提供方 |
| `Ctrl+X` | 开关上一轮上下文 |
| 两次 `Ctrl+S` | 确认将编辑后的预览追加到当前草稿 |
| `Esc` | 生成时取消，其余时候关闭面板并保留预览 |

在同一会话运行空参数 `/prompt-optimize` 可以重新打开面板。TUI 的公开追加接口没有接收回执，成功提示表示请求已写出，请检查主输入框后自行发送。追加失败时保留预览，不自动重试。已有原稿保留尚未完成实际验收，见[已知限制](docs/validation.md#未完成事项与已知限制)。

## 兼容版本

| 部分 | 目标版本 |
| --- | --- |
| Web UI / 桌面端 | DeepSeek Harness `0.2.0-rc.2` |
| Host API | `0.1.7-rc.2` 或 `0.2.0-rc.2` |
| TUI | `@deepseek-harness-tui/dsh-tui@0.11.1` |
| Cordis / Web React | `4.0.4` / `18.3.1` |
| Node.js | 22 或更新版本 |

Web/桌面端安装 `dsh-prompt-optimizer`，TUI 安装 `dsh-prompt-optimizer-tui`。同一个 Profile 选择一个发行包，避免重复注册服务。TUI 包移除了浏览器依赖，以兼容旧版 CLI 的 peer 检查，并使用宿主提供的 React。

Profile 应由版本匹配的 CLI 管理。桌面应用的内置 runtime 可能与全局 `dsh` 不同，请先检查版本和实际依赖。

## 构建和打包

在仓库根目录执行：

```powershell
npm ci
npm run check
npm run pack:artifact
npm run pack:tui
```

安装包输出到：

- `artifacts/dsh-prompt-optimizer-0.1.3.tgz`
- `artifacts/dsh-prompt-optimizer-tui-0.1.3.tgz`

`npm run check` 包含 Host/Client TypeScript 检查、测试、三个 bundle 构建、包结构检查、真实 Cordis/Connection 注册检查，以及客户端行为验证。单项命令可在 `package.json` 中查看。

## 安装

可自行构建，或从项目 GitHub Releases 下载对应版本的 `.tgz` 安装包并放入 `artifacts/`。以下命令在仓库根目录运行，使用相对安装包路径；Profile 名称按你的环境调整。

### 桌面端

PowerShell 示例；`$desktopApp` 可改为实际桌面安装目录中的 `resources/app`：

```powershell
$desktopApp = Join-Path $env:ProgramFiles 'DSH Desktop\resources\app'
$desktopCli = Join-Path $desktopApp 'lib\desktop-cli.js'

node $desktopCli --version
npm run check:runtime -- $desktopApp --surface desktop
node $desktopCli plugin --profile desktop add './artifacts/dsh-prompt-optimizer-0.1.3.tgz'
```

内置 CLI 应为匹配的 `0.2.0-rc.2` runtime。安装后重启对应 Harness 窗口，加载 Host 和浏览器插件。

### Web UI

确认管理该 Profile 的 `dsh --version` 为 `0.2.0-rc.2`：

```powershell
dsh plugin --profile web add './artifacts/dsh-prompt-optimizer-0.1.3.tgz'
```

重启 Web Host 并刷新页面。插件 bundle 自动应用 `cordis.patch.yml`，无需复制源码或修改 Harness 内置包。

### TUI

目标 Profile 需已安装 `@deepseek-harness-tui/dsh-tui@0.11.1`。使用管理该 Profile 的 CLI：

```powershell
$tuiProfile = 'dsh-tui'
$tuiProfileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$tuiProfile"

npm run check:runtime -- $tuiProfileDir --surface tui
dsh plugin --profile $tuiProfile add './artifacts/dsh-prompt-optimizer-tui-0.1.3.tgz'
dsh $tuiProfile
```

TUI 包自动加载 Host 服务和 `/tui` 入口。启动后输入 `/prompt-optimize 需要优化的需求`，或用空参数命令打开面板填写。

## AI 提供方

**Harness AI** 复用当前聊天选中的模型及登录配置，请先选择可用模型。请求显式使用空工具列表。

**Codex** 使用 Host 上版本匹配的官方 `dsh-subagent-codex` provider，需要 Host 具有有效的 Codex 原生登录状态。远程网页使用的是 Host 的 Codex 环境。官方 provider bundle 提供配套原生 CLI。

原始需求作为待改写内容传入；优化指令要求保留目标、事实与限制，缺失信息使用待补充标记，仅返回优化文本。Codex 继承官方 provider 的权限和沙箱配置；公开接口没有逐次禁用工具的参数，插件不能保证 Codex 全程只读。

### 配置专用 Codex 模型

官方 provider 的原生 `model` 固定在实例配置中。本插件通过 `codexProviderName` 选择一个专用实例，可与已有 `codex` provider 共存。

在目标 Profile 的 overlay 中加入以下 patch。将模型名改为该 Host 原生运行时和账号可用的模型；示例使用 `gpt-5.6-luna`：

```yaml
- insert:
    - id: prompt-optimizer-codex
      name: '@deepseek-ai/dsh-subagent-codex'
      config:
        providerName: prompt-optimizer-codex
        model: gpt-5.6-luna
        permissionMode: never
- id: prompt-optimizer
  config:
    codexProviderName: prompt-optimizer-codex
```

服务行的 `id` 应与目标 Profile 一致。`insert` 用于新增 provider；后面的条目用于更新已有优化服务。Desktop 的 Electron Host 还需在专用 provider 的 `config` 中加入：

```yaml
env:
  ELECTRON_RUN_AS_NODE: '1'
```

这使官方 Node wrapper 正常运行。`permissionMode: never` 控制审批方式，并继承原生沙箱配置。模型应从配套原生运行时的 `model/list` 选择，再通过真实生成检查账号可用性；Codex App 展示的别名不一定与该运行时相同。

目标 provider 未注册时会显示不可用，不回退到其他实例。原生模型或请求被拒绝时，界面显示固定的配置提示，保留预览，不复制原生错误正文。

## 插件配置

Host 导出 `Config` schema，可在 Harness 插件配置界面调整：

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `timeoutMs` | `120000` | 每次优化最多等待 120 秒 |
| `maxInputChars` | `20000` | 原始需求字符上限 |
| `maxContextChars` | `16000` | 上一完整回合的上下文字符上限 |
| `maxOutputTokens` | `4096` | Harness AI 最大输出 token 数 |
| `harnessProvider` | 未设置 | 固定使用某个已注册提供方 |
| `harnessModel` | 未设置 | 固定使用该提供方的模型 |
| `codexProviderName` | `codex` | 目标 Profile 中注册的官方 Codex 实例 |

默认使用当前聊天模型。固定 Harness 模型时，`harnessProvider` 与 `harnessModel` 必须同时填写。

## 项目目录

```text
src/
  server/          Host 服务、模型调用、请求取消与结果校验
  client/          Web/桌面端页面、左栏入口与草稿保护
  tui/             TUI 面板、快捷键与草稿追加
  shared/          请求和结果类型
locale/            中文、英文文案
scripts/           构建、打包与 runtime 检查
tests/             行为与集成测试
docs/validation.md 验收范围与已知限制
cordis.patch.yml   Web/桌面端 bundle patch
tui.patch.yml      TUI bundle patch
lib/               构建产物（生成）
artifacts/         安装包（生成）
```

浏览器 bundle 使用 Harness 的共享 React/Cordis 模块；Host、Client、TUI 分开构建，不依赖 Harness monorepo 目录结构。

## 连接与聊天数据

Web/桌面端通过官方 Connection 的精确 `/api` route 发送优化请求，复用宿主认证与取消机制；浏览器不直接读取模型凭据。

优化请求、澄清问答和结果不作为一轮用户消息写入聊天。插件不会自动发送聊天，也不会把私有优化事件追加到持久化聊天日志，避免影响官方冷恢复。
