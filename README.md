# Agent Studio MVP

多agent协同，调用本地订阅CLI的方式。

一个本地可运行的多 Agent 网页控制台（AutoGen Studio 风格 MVP）。

![Agent Studio UI](docs/agent-studio-ui.png)

支持：
- 模型配置（本地 CLI：`claude` / `codex` / `gemini`）
- Agent 配置（角色、system prompt、specialties）
- Team 配置（manager + 成员）
- 团队运行策略：`single-route` / `broadcast` / `manager-decide`
- 成员并行执行、超时跳过、取消运行
- 进度条与运行阶段提示
- 卡片式回答展示（成员回答 + 开发经理总结）
- 模型测试按钮（验证非交互参数）

## 快速开始

```bash
npm install
npm start
```

打开：`http://localhost:3000`

## 环境要求

- Node.js 18+
- 可选（如果要跑真实模型）：本机已安装并可直接执行以下 CLI
  - `claude`
  - `codex`
  - `gemini`

## 功能说明

### 1. Models
配置本地命令行模型适配器：
- `command`：执行命令（例如 `codex`）
- `argsTemplate`：参数模板，使用 `{{prompt}}` 注入提示词

示例：
- `claude`: `-p "{{prompt}}"`
- `codex`: `exec "{{prompt}}"`
- `gemini`: `"{{prompt}}"`

点击 `Test Model` 可快速验证当前模型是否能以非交互方式执行。

### 2. Agents
配置 Agent：
- 名称
- 角色（manager/specialist）
- 模型绑定
- system prompt
- specialties（用于关键词路由）

### 3. Teams
配置团队：
- manager agent
- 成员列表
- 策略（strategy）

策略说明：
- `single-route`: manager/关键词逻辑选择一个成员执行
- `broadcast`: 所有成员并行执行，开发经理汇总
- `manager-decide`: 先让 manager 规划，再决定单路由或广播

## 运行与展示

- 运行时显示阶段进度（规划 / 成员执行 / 汇总）和进度条
- 支持 `Cancel` 提前终止当前运行
- 输出区为卡片式消息：
  - 每个成员 agent 一张卡片（只显示回答内容）
  - 最后一张为 `开发经理` 总结
  - 调试信息默认折叠（stderr / code / model 等）

## 数据存储

本地配置默认保存到：

- `data/studio-config.json`

> 该文件已被 `.gitignore` 忽略，不会上传到 GitHub。

## 已知限制（MVP）

- 依赖本机 CLI 的非交互参数正确配置，否则可能等待输入直到超时
- `manager-decide` 规划输出为模板/JSON 解析，解析失败会自动回退 `broadcast`
- 前端当前为原生 HTML/CSS/JS（便于快速迭代）

## 后续可扩展

- SSE/WebSocket 流式 token 输出
- 卡片逐步更新（哪个 agent 先完成先落卡）
- 图形化 Team 编排（节点/连线）
- API 模型适配（OpenAI / Anthropic / Gemini API）
- 会话历史与项目级工作区隔离
