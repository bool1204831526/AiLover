# AiLover V1 开发规划

> 状态：架构基线草案  
> 日期：2026-09-10  
> 依据：《AiLover AI Companion 需求规格说明书 V1.0》

## 1. 开发目标

第一阶段只验证一个核心命题：AiLover 能否在长期互动中始终表现为“同一个人”。

MVP 必须形成以下闭环：

```text
创建角色 -> 建立结构化身份 -> 开始对话 -> 自动形成记忆
        -> 后续召回 -> 情绪/关系变化 -> 响应行为发生连续变化
```

首版成功标准不是功能数量，而是以下五项：

1. 身份一致：名称、背景、表达习惯和边界不会无故漂移。
2. 记忆一致：重要事实和共同经历能在合适时机被正确召回。
3. 人格连续：人格只在有依据、有限幅度下逐步变化。
4. 状态连续：情绪与关系由事件驱动，并随时间自然变化。
5. 行为可解释：重要状态变化可以追溯到事件和规则。

## 2. 范围边界

### 2.1 MVP 范围（本轮开发目标）

- Windows 10/11 可安装桌面应用
- 单用户、单 AI Lover（数据模型保留多角色能力）
- 角色创建向导：基本身份、人格模板、自定义外貌、背景和说话风格
- 参考图片导入、角色头像管理，以及可选的图片生成服务
- 文本聊天与流式输出
- OpenAI-compatible 云端模型和 Ollama 本地模型接入
- 分层记忆、混合检索、记忆形成与衰减
- 独立的人格、情绪、关系状态模型
- 事件记录与重要交互反思
- 默认本地存储、备份与恢复
- 核心模块自动测试和一条端到端连续性测试

### 2.2 MVP 不实现

- TTS、STT、语音唤醒
- 2D 动态桌宠和 Live2D
- 主动消息、后台长期自主行为
- Windows 文件/应用操作和 MCP
- 屏幕感知、浏览器自动化
- 3D、VR/AR、多设备同步、多 AI 社交

这些能力需要预留端口和事件类型，但不能影响 MVP 主链路。

## 3. 技术栈决策

采用全 TypeScript 单体模块化架构，先减少桌面端、领域逻辑和数据层之间的运行时边界；当模型或媒体计算确实需要独立进程时，再通过既有端口增加 Python 服务。

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面外壳 | Electron | Windows 安装、系统托盘、通知和未来桌宠窗口能力成熟 |
| 前端 | React + TypeScript + Vite | 组件生态稳定，开发反馈快 |
| 状态管理 | Zustand + TanStack Query | UI 本地状态与异步服务状态分离 |
| UI 基础 | Radix UI + Tailwind CSS + Lucide | 无障碍原语、可控视觉体系、统一图标 |
| 领域与应用层 | TypeScript packages | 与 UI、Electron、模型供应商解耦 |
| 数据库 | SQLite + Drizzle ORM | 本地优先、迁移透明、便于备份 |
| 文本检索 | SQLite FTS5 | 无外部服务即可工作 |
| 向量检索 | `EmbeddingStore` 适配器 | MVP 可选嵌入；未配置时退化为 FTS5 + 结构化评分 |
| 数据校验 | Zod | IPC、模型结构化输出和配置共用 Schema |
| 日志 | Pino | 结构化日志，生产环境默认脱敏 |
| 测试 | Vitest + Testing Library + Playwright | 单元、组件和桌面端关键流程覆盖 |
| 工程 | pnpm workspace + ESLint + Prettier | 统一依赖与质量检查 |
| 打包 | electron-builder | 生成 Windows NSIS 安装包 |

不在 MVP 引入微服务、消息中间件、独立向量数据库或复杂工作流框架。内部边界通过接口和领域事件保持，部署仍是一个桌面应用。

## 4. 总体架构

```text
Renderer (React)
  Chat / Creator / Character / Relationship / Settings
              |
       typed IPC contracts
              |
Electron Main + Application Services
  ChatOrchestrator / CharacterService / BackupService
              |
  +-----------+-----------+-----------+-----------+
  |           |           |           |           |
Character   Memory    Affect Core   Agent Core   Model Gateway
Domain      Engine    emotion +     decision +  chat/image/
                       relation       reflection  embedding
  |           |           |           |           |
  +-----------+-----------+-----------+-----------+
              |
      Repositories + Event Bus
              |
       SQLite / local assets
```

### 4.1 进程安全边界

- Renderer 不启用 Node integration。
- Preload 仅通过 `contextBridge` 暴露白名单 API。
- 所有 IPC 入参与返回值都通过 Zod 校验。
- API 密钥使用 Windows Credential Manager；数据库只保存凭据引用。
- 本地资产只允许从应用数据目录或用户明确选择的文件读取。
- 未来 Tool Runtime 必须位于主进程侧，并强制经过 Permission Manager。

### 4.2 建议目录

```text
AiLover/
├── apps/
│   └── desktop/
│       ├── src/main/
│       ├── src/preload/
│       └── src/renderer/
├── packages/
│   ├── contracts/       # IPC、事件、模型结构化输出 Schema
│   ├── domain/          # 纯领域实体、值对象、规则
│   ├── application/     # 用例与编排
│   ├── persistence/     # SQLite、迁移、Repository 实现
│   ├── model-gateway/   # LLM/Image/Embedding Provider
│   ├── memory/          # 形成、检索、衰减、整合
│   ├── cognition/       # 情绪、关系、人格演化、反思
│   └── observability/   # 日志、指标、审计与脱敏
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
└── scripts/
```

依赖方向固定为：`UI/Infrastructure -> Application -> Domain`。Domain 不依赖 Electron、数据库、React 或具体模型 SDK。

## 5. 核心模块与接口

### 5.1 Character

职责：角色身份、初始人格、表达风格、视觉身份和行为边界。Character 是结构化实体，不是 system prompt。

```ts
interface CharacterService {
  create(draft: CharacterDraft): Promise<Character>;
  get(characterId: CharacterId): Promise<CharacterSnapshot>;
  updateProfile(characterId: CharacterId, patch: CharacterProfilePatch): Promise<void>;
}
```

初始模板生成后保存为稳定基线；运行时人格状态单独保存，防止长期成长覆盖用户最初设定。

### 5.2 Model Gateway

```ts
interface ChatModel {
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelChunk>;
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
}

interface EmbeddingModel {
  embed(texts: string[]): Promise<number[][]>;
}

interface ImageModel {
  generate(request: ImageGenerationRequest): Promise<GeneratedAsset[]>;
  describe(image: ImageInput): Promise<AppearanceDescription>;
}
```

首批 Provider：`OpenAICompatibleProvider`、`OllamaProvider`。聊天、结构化提取、嵌入和图片能力分别探测，不假定一个 Provider 拥有全部能力。

### 5.3 Cognition

- `EmotionEngine`：根据前态、事件影响、人格倾向和时间衰减计算新状态。
- `RelationshipEngine`：根据有证据的交互更新信任、亲密、好感、熟悉、依赖、舒适和冲突。
- `PersonalityEvolutionEngine`：只消费累积证据或高强度事件，使用速率上限和变化日志。
- `ReflectionService`：仅对达到阈值的重要互动异步执行，不阻塞首屏回复。

所有数值范围统一为 `[0, 1]`，更新同时保存 `reason`、`source_event_id`、`delta` 和规则版本。

### 5.4 Event Bus

MVP 使用进程内事件总线，并将需要审计或重放的重要事件同步写入 SQLite Outbox。处理器必须幂等；事件处理失败记录重试状态，不得让聊天整体崩溃。

```ts
type DomainEvent<T> = {
  id: string;
  type: EventType;
  version: 1;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  payload: T;
};
```

首批事件：

- `character.created`
- `conversation.started`
- `message.received`
- `message.completed`
- `memory.candidate_extracted`
- `memory.created`
- `memory.reinforced`
- `memory.recalled`
- `emotion.changed`
- `relationship.changed`
- `personality.changed`
- `reflection.completed`
- `model.request_failed`
- `asset.created`

后续预留：`user.inactive`、`ai.message_initiated`、`tool.requested`、`permission.requested`、`character.action_requested`。

## 6. 数据库 Schema 基线

所有表使用 UUID/ULID 文本主键、UTC 时间戳和显式 schema version。JSON 只用于结构确实可变的附属字段，身份、状态、关联和检索字段必须正规化。

| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `users` | `id`, `display_name`, `locale`, `timezone` | 本地用户身份 |
| `characters` | `id`, `name`, `status`, `created_at` | 角色聚合根 |
| `character_profiles` | `character_id`, `identity`, `background`, `appearance`, `speaking_style`, `values`, `behavior_rules`, `version` | 相对稳定的角色档案 |
| `personality_baselines` | `character_id`, trait dimensions, `template_id` | 初始人格基线 |
| `personality_states` | `id`, `character_id`, trait dimensions, `reason`, `source_event_id`, `recorded_at` | 可追溯人格快照 |
| `emotion_states` | `id`, `character_id`, emotion dimensions, `reason`, `source_event_id`, `recorded_at` | 当前与历史情绪快照 |
| `relationship_states` | `id`, `user_id`, `character_id`, relationship dimensions, `summary`, `source_event_id`, `recorded_at` | 双方关系状态 |
| `conversations` | `id`, `user_id`, `character_id`, `title`, `started_at`, `last_message_at` | 会话 |
| `messages` | `id`, `conversation_id`, `role`, `content`, `status`, `model`, `created_at` | 原始对话事实 |
| `memories` | `id`, `user_id`, `character_id`, `type`, `subject`, `content`, scoring fields, `state`, `first_seen_at`, `last_recalled_at` | 长期记忆主体 |
| `memory_sources` | `memory_id`, `message_id`/`event_id`, `evidence`, `created_at` | 记忆证据链 |
| `memory_embeddings` | `memory_id`, `provider`, `model`, `dimensions`, `vector`, `created_at` | 可替换嵌入数据 |
| `memory_links` | `from_memory_id`, `to_memory_id`, `relation`, `weight` | 冲突、补充、演化关系 |
| `events` | event envelope fields, `payload`, `processing_status` | 审计与 Outbox |
| `reflections` | `id`, `trigger_event_id`, `summary`, `importance`, `output`, `created_at` | 重要互动反思 |
| `assets` | `id`, `character_id`, `type`, `path`, `mime_type`, `checksum`, `metadata` | 头像、全身图、表情等 |
| `model_profiles` | `id`, `provider`, `capability`, `model`, `endpoint`, `credential_ref`, `settings` | 模型配置，不存明文密钥 |
| `settings` | `scope`, `scope_id`, `key`, `value`, `updated_at` | 应用设置 |

关键约束：

- `messages` 是不可变事实；编辑采用新版本或状态标记。
- `memories` 不因一句“忘记”直接物理删除；用户请求形成事件并改变可召回状态。
- 用户仍必须能从产品设置中彻底删除或导出自己的本地数据。这属于数据权利，不交由角色自主性裁决。
- 状态表保留历史快照，另用索引或 current pointer 快速取得当前状态。
- 数据库迁移只能前向执行，并在正式迁移前自动备份。

## 7. Memory Architecture

### 7.1 分层实现

| 层 | MVP 实现 |
| --- | --- |
| Working | 当前轮上下文与有限消息窗口，不单独长期保存 |
| Short-term | 近期消息摘要和具有过期时间的候选记忆 |
| Episodic | 带时间、参与者和事件证据的共同经历 |
| Semantic | 用户、角色与世界的稳定事实 |
| Preference | 喜好、厌恶、习惯、交流偏好 |
| Relationship | 纪念日、承诺、冲突、和解、特殊称呼 |
| Emotional | 事件、原因、情绪影响与关系影响 |
| Important/Fading | 不是独立内容类型，而是记忆状态和评分结果 |

### 7.2 写入流水线

```text
message.completed
  -> Candidate Extractor（结构化输出）
  -> Deterministic Validator（证据、置信度、隐私与重复检查）
  -> Deduplicate / Merge / Contradiction Link
  -> Save memory + source
  -> Optional embedding
  -> memory.created / memory.reinforced
```

不得把模型推断当作用户事实直接保存。低置信度推断只能作为候选；事实记忆必须能指向消息或事件证据。

### 7.3 检索流水线

```text
当前输入 -> 查询意图与实体 -> 并行候选召回
        -> FTS5 + metadata + optional vector + recent episodes
        -> 去重和权限过滤 -> 综合排序 -> token budget 裁剪
        -> Context Assembler
```

建议初始排序公式（权重配置化并记录版本）：

```text
score = 0.30 semantic_relevance
      + 0.18 lexical_relevance
      + 0.14 importance
      + 0.10 confidence
      + 0.10 recency
      + 0.08 frequency
      + 0.06 emotional_weight
      + 0.04 relationship_weight
```

没有嵌入服务时，将 semantic 权重按比例分配给 lexical、importance 与 recency。测试验证排序行为，不把具体权重写死在业务用例中。

### 7.4 衰减与遗忘

- Recall strength 按记忆类型使用不同半衰期。
- 召回、重复确认或强情绪事件会强化记忆。
- 重要关系事件设置最低强度，不自动消失。
- 衰减只影响召回概率，不立即删除原始证据。
- 冲突事实并存并建立 `supersedes`/`contradicts` 链，由新证据和时间决定当前解释。

## 8. Agent 与响应架构

MVP Agent 是受约束的响应编排器，不是开放式自主循环。

```text
1. 接收 PerceptionEvent(text)
2. 保存用户消息
3. 分析意图、主题、风险和情绪信号
4. 检索相关记忆
5. 读取角色、人格、情绪和关系当前快照
6. 使用确定性规则计算临时情绪/关系影响建议
7. Context Assembler 在预算内生成模型请求
8. 模型输出严格的 ResponsePlan
9. 校验、修复一次或退化为纯文本响应
10. 流式输出并保存助手消息
11. 提交状态变化和领域事件
12. 达到阈值时异步执行记忆提取与 Reflection
```

```ts
type ResponsePlan = {
  kind: 'respond' | 'ask_question' | 'decline' | 'do_nothing';
  text: string;
  tone: string[];
  referencedMemoryIds: string[];
  proposedEmotionEffects: StateEffect[];
  proposedRelationshipEffects: StateEffect[];
  animationHint?: string;
};
```

模型只能提出状态变化，领域引擎负责校验幅度、冷却时间、证据和边界。任何模型输出无效时，系统仍能以当前上下文完成普通对话。

### 8.1 Context Assembly 顺序

1. 安全与行为边界
2. 角色稳定身份摘要
3. 当前人格、情绪和关系的自然语言投影
4. 当前会话窗口
5. 已排名且带来源的相关记忆
6. 当前用户输入
7. 输出 Schema

每段有独立 token 预算；不得拼接全部历史或全部记忆。系统记录发送字段类别和 token 数，但生产日志不记录完整私密正文。

## 9. 桌面端 API / IPC Schema

Renderer 只调用面向用例的 API，禁止直接访问数据库或模型 Provider。

| 方法 | 请求 | 响应/事件 |
| --- | --- | --- |
| `app.bootstrap` | 无 | 用户、角色、配置能力摘要 |
| `character.create` | `CharacterDraft` | `CharacterSnapshot` |
| `character.get` | `characterId` | `CharacterSnapshot` |
| `character.update` | `CharacterProfilePatch` | `CharacterSnapshot` |
| `asset.importReference` | 文件选择 token、类型 | `Asset` |
| `asset.generate` | `characterId`, scene/options | `GenerationJob` |
| `conversation.list` | `characterId`, cursor | 分页会话 |
| `conversation.create` | `characterId` | `Conversation` |
| `chat.send` | `conversationId`, text, clientMessageId` | 接受回执 |
| `chat.cancel` | `requestId` | 完成状态 |
| `chat.stream` | 订阅 `requestId` | chunk/completed/failed 事件 |
| `relationship.getSummary` | `characterId` | 用户可理解的关系摘要，不暴露内部调参面板 |
| `modelProfile.list/save/test` | 脱敏模型配置 | 能力和测试结果 |
| `data.exportBackup` | 目标选择 token | 备份结果 |
| `data.restoreBackup` | 文件选择 token | 校验与恢复结果 |
| `data.deleteAll` | 明确确认凭据 | 删除结果 |

所有错误统一为 `{ code, message, retryable, correlationId, details? }`，UI 不显示供应商密钥、堆栈或内部 prompt。

## 10. UI 信息架构

MVP 首屏直接进入可用体验，不制作营销页。

- 首次启动：欢迎与本地隐私说明 -> 模型设置 -> 角色创建向导 -> 确认角色 -> 首次聊天。
- 主界面：紧凑侧栏、角色视觉区、聊天区、固定输入区。
- 侧栏：聊天、角色、关系、设置。Memory 不作为数据库查看器出现。
- 角色页：稳定档案与视觉资产；动态人格以自然语言表现，不提供随意拖动内部状态的面板。
- 关系页：共同经历与关系描述，不展示“好感度刷分攻略”。
- 模型不可用：保留角色和历史浏览能力，给出清晰的配置或重试路径。

## 11. 开发阶段与质量门槛

以下工期按 1 名全职开发者估算，用于排序而非承诺日期。

### Phase 0：架构基线与项目骨架（2-3 天）

- 初始化 Git、pnpm workspace、Electron/React/TypeScript
- 建立 packages、依赖方向和共享 contracts
- 加入 lint、typecheck、unit test、build、Windows packaging 骨架
- 建立 ADR、配置加载、脱敏日志和错误模型

完成门槛：开发模式可启动；最小窗口渲染；所有质量命令通过；能生成未签名 Windows 安装包。

### Phase 1：数据与 Character（4-5 天）

- SQLite 初始化、迁移、Repository 和事务边界
- Character 聚合、模板、创建向导与本地资产导入
- 用户数据目录、备份格式 v1、恢复前校验
- OpenAI-compatible/Ollama 模型配置和连通性测试

完成门槛：离线完成角色创建、重启后状态一致；迁移和备份恢复测试通过。

### Phase 2：可靠聊天主链路（4-5 天）

- 会话与消息持久化
- Model Gateway、流式响应、取消、超时、重试和降级
- Context Assembler v1 与 token budget
- 聊天 UI 的发送、流式、错误、空状态和重载恢复

完成门槛：连续多轮聊天稳定；模型失败不破坏会话；应用重启可恢复历史。

### Phase 3：Memory v1（6-8 天）

- 候选提取、证据校验、去重/强化/冲突链接
- FTS5 与可选 embedding 适配器
- 混合召回、排序、预算裁剪、召回审计
- 衰减维护任务和相关测试

完成门槛：“喜欢咖啡”、近期计划、重要共同事件三类场景可在跨会话和模拟跨日后正确召回；无证据幻觉不进入稳定事实。

### Phase 4：Cognition v1（6-8 天）

- 情绪状态机、时间衰减与规则版本
- 关系状态和有界变化
- 人格基线、演化证据和速率限制
- ResponsePlan、Reflection 和状态投影

完成门槛：积极/负面事件产生符合预期的有界变化；跨重启连续；人格不会因单轮对话反转；所有变化可追溯。

### Phase 5：产品闭环与视觉资产（5-7 天）

- 完整首次启动、角色确认、聊天、关系摘要流程
- 参考图分析接口和图片生成 Provider 能力探测
- 角色视觉身份描述、生成参数与资产版本记录
- 无图片 Provider 时的导入/占位降级体验

完成门槛：新用户能独立完成创建并进入聊天；生成或导入的资产归属明确；供应商失败不影响聊天。

### Phase 6：硬化与 MVP 发布（5-7 天）

- 端到端长期连续性测试、故障注入和数据迁移测试
- 隐私审计、日志脱敏、API 数据最小化检查
- 性能、启动时间、数据库索引和内存泄漏检查
- Windows 10/11 安装、升级、卸载和备份恢复验证
- 版本说明、已知限制和诊断包（默认不含对话正文）

完成门槛：所有发布检查通过，无 P0/P1 缺陷，能从干净 Windows 环境安装运行。

预计 MVP 总量：约 5-7 周。加入在线图片生成的一致性调优、代码签名和自动更新会额外增加时间与外部依赖。

## 12. MVP 后路线

### V1.1：主动陪伴与 2D 桌宠

- Scheduler 和行为评估，而非固定时间骚扰
- 通知频率、免打扰时段和退出机制
- 独立透明桌宠窗口、基础状态动画与交互
- 动画由 `CharacterAction` 事件驱动

### V1.2：语音与多模态

- Push-to-talk、STT/TTS Provider、Voice Profile
- 图片聊天和视觉理解
- 输入统一为 `PerceptionEvent`，输出统一为多通道 `Action`

### V1.3：受控桌面 Agent

- Tool Registry、Permission Manager、Risk Evaluator 和审计日志
- 首批只读/低风险工具；写入和删除必须确认
- 计划、执行、结果验证三阶段分离
- MCP Client 作为工具来源之一，不能绕过权限层

### V2+

- Live2D、唤醒词、环境感知、高级 Agent、长期自主活动
- 3D、VR/AR、移动端、多设备和多角色世界系统

## 13. 测试策略

### 单元测试

- Character 验证和模板合并
- Memory 评分、衰减、去重、冲突和召回排序
- Emotion 衰减与边界
- Relationship 正负事件更新
- Personality 速率限制和证据阈值
- Context token budget 和隐私裁剪

### 集成测试

- SQLite 迁移、事务、Repository、FTS5
- 模型 Provider 的录制响应与错误映射
- 消息 -> 事件 -> 记忆 -> 下轮召回完整链路
- Outbox 重试和处理器幂等
- 备份、恢复、升级与损坏文件拒绝

### E2E 验收场景

1. 创建“温柔、略傲娇、喜欢读书”的角色，重启后身份与风格不变。
2. 用户表达喜欢咖啡，在新会话和模拟第二天后被自然召回。
3. 用户提到明天面试，近期召回强；时间过久后自然减弱。
4. 连续积极互动提高信任与亲密；负面事件提高冲突，但单轮不造成关系极端翻转。
5. 夸奖提高幸福/亲密相关状态，时间推进后情绪衰减而人格不变。
6. 模型、Embedding 或图片服务失败时，聊天历史和本地数据不损坏。
7. 云端请求只包含当前上下文、必要状态和已选相关记忆。

测试模型变化时，领域规则使用确定性 fixtures；真实模型只做少量契约与人工体验评估，避免把随机文本断言当作核心测试。

## 14. 可观测性与隐私

- 每次交互生成 `correlationId`，串联模型、记忆、状态与错误事件。
- 默认记录耗时、token、Provider、状态码和选中记忆 ID，不记录完整正文。
- 开发诊断正文日志必须显式开启，并醒目标明隐私风险。
- 备份包含数据库、资产和 manifest；密钥默认不包含。
- 任何云端 Provider 首次启用时说明会发送的数据类型。
- 产品必须提供数据导出和彻底删除。这一要求优先于“角色不愿遗忘”的叙事机制。

## 15. 主要风险与应对

| 风险 | 应对 |
| --- | --- |
| LLM 输出导致人格漂移 | 稳定身份优先、结构化 ResponsePlan、领域引擎限制状态变化 |
| 模型把推断写成事实 | 证据链、置信度阈值、候选态、冲突检测 |
| 长期记忆召回不准 | 混合检索、类型过滤、离线评测集、记录排序解释 |
| 情绪和关系像游戏数值 | UI 只展示自然语言摘要；内部变化低幅、有原因、有衰减 |
| 原生依赖影响 Electron 打包 | 在 Phase 0 验证 SQLite 依赖与 Windows 安装包，不拖到发布前 |
| 图片一致性受供应商限制 | 保存视觉身份、参考资产、种子/参数/Provider；能力不足时明确降级 |
| 云端隐私泄露 | Context 最小化、日志脱敏、密钥系统存储、Provider 启用告知 |
| 功能扩张拖垮主闭环 | 每阶段必须过完成门槛；桌宠、语音、Tool 不进入 MVP 主链 |

## 16. 开发执行规则

1. 每个阶段开始前补齐相关 ADR 和接口契约。
2. 每个模块先写领域规则测试，再接数据库、模型和 UI。
3. 每次数据库变更必须包含迁移、回滚/恢复说明和升级测试。
4. 每个 Provider 都必须有能力探测、超时、取消、错误归一化和降级路径。
5. 每完成一个阶段，执行 lint、typecheck、unit、integration、build；发布阶段再执行 E2E 与安装测试。
6. 未通过当前阶段完成门槛，不开始依赖它的下一阶段。
7. 新功能若绕过 Event、Repository、Model Gateway 或 Permission 边界，应先修正架构而不是直接接入 UI。

## 17. 开工前待确认项

以下选择不阻塞项目骨架和核心领域开发，但应在对应阶段开始前确定：

1. 首发是否同时支持 OpenAI 官方 API，或只承诺 OpenAI-compatible 与 Ollama。
2. MVP 图片能力使用哪个生成/视觉 Provider；是否接受“无 Provider 时只导入角色图”的降级模式。
3. 首发是否需要代码签名和自动更新；二者涉及证书与发布基础设施。
4. 支持的界面语言是否仅简体中文，还是从 MVP 起建立中英双语文案。
5. 年龄设定、成人内容、危机话题和情感依赖边界，需要在产品安全规范中单独定义。

## 18. 下一步

确认本规划后进入 Phase 0，只创建项目骨架、架构决策记录、核心接口和数据库迁移框架；运行、测试和打包通过后再进入 Character 模块。
