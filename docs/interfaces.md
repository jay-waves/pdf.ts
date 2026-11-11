# 接口边界与本轮审查

## 责任归属

| 边界 | 对外能力 | 内部封装与审查结论 |
| --- | --- | --- |
| `apps/platform/types.ts` | 加载资源、准备写入、偏好与 AI 请求 | 保留平台能力接口。权限准备必须在用户手势中发生，因此与 Worker 写入分离；不合并为后台隐式授权。 |
| `apps/shared/pdf-file.ts` | PdfWritePlan / PdfWriteResult | 保留跨层数据契约。Worker 决定事务版本，平台执行 IO；平台不依赖 renderer 或 engine 实现。 |
| `apps/engine/shared-document-host.ts` | 打开、编辑状态、保存、关闭 | 保留文件身份、共享会话、历史与草稿协调的权威入口。UI 不接管版本判断。 |
| `DocumentSaveCoordinator` | save | 封装完整序列化、冲突副本重试、写回确认与修订推进；转移后的重试重新获取字节。 |
| `DraftSession` | 恢复、变更通知、合并前后处理、关闭 | 封装防抖、草稿存储令牌、冲突及恢复状态。合并内部已持有保存通道，不能递归排队。 |
| `SaveLane` | run(operation), settled() | 本轮替换公开可写 tail。内部拥有 FIFO、失败隔离和不保留输出的尾 Promise；调用方不再拼接或覆盖队列。 |
| renderer / EmbedPDF | 页面呈现与渲染需求 | 保留 SDK 的调度和缓存所有权，Canvas 层负责绘制；参数与检查见 rendering.md。 |

## SaveLane 契约

- `run` 返回本次操作的结果或错误。前一个操作失败后，后续操作仍执行。
- 操作必须包含其清理步骤；清理完成后才允许下一个操作启动。
- `settled` 等待调用时已提交的工作，不返回操作输出，也不保证未来不再提交工作。
- 同一文件的不同会话可共享通道；不同文件不因此相互阻塞。
- 已持有通道的代码直接执行内部步骤，不在其中等待同一通道的另一个任务。
- 原生快照只在引擎队列中获取；磁盘等待留在保存通道，允许期间继续编辑。

迁移覆盖保存协调器、草稿排队、宿主关闭及测试。定向检查：

```sh
node --test tests/document-save.test.mjs tests/draft-storage.test.mjs tests/document-draft.test.mjs
pnpm typecheck
```

测试覆盖串行写入、失败恢复、清理顺序、共享通道、编辑期间写回、冲突副本、缓冲区转移以及草稿恢复。此轮不改变外部文件格式、平台能力或 UI 操作。

## 按功能模块的后续扫描与优化

| 模块 | 本轮结果 | 调用方减少的责任 / 保留原因 |
| --- | --- | --- |
| AI | 新建 `apps/ai/`，以 `AiService` 统一 request / getConfig / configure | 平台从三个独立可选方法收敛为一个可选 `ai` 能力；服务内部管理凭据、请求、流和用量。配置默认值独立于浏览器实现，UI 不重复定义。 |
| 文档输出 | `createDocumentOutput` 绑定文档上下文 | UI 使用 saveDocument / exportDocument / saveCopy；无需每次传递 engine、registry、documentId、fileHandle。模块封装权限顺序、完整序列化与共享保存分流。 |
| 文档替换 / 视图 | `ViewerStage.captureView()` / `restoreView(checkpoint, signal)` | 替换流程不再访问 StageToken 的缩放和旋转接口；恢复顺序、帧等待、阅读锚点和演示页恢复归 ViewerStage。替换流程仍负责解锁、脏状态确认、首屏绘制与提交。 |
| 注释 | 颜色 patch 构建改为内部函数，去掉无效 toolId 参数 | 外部继续使用带工具策略的 preset 接口；颜色映射实现不作为公共能力暴露。 |
| 字体 | 公共入口只导出目录和类型 | 原生字体管理器由 engine 显式引用，避免 UI 入口暴露 PDFium ABI 实现。字体加载、匹配及诊断保持集中。 |
| 搜索 | 保留 SDK 搜索能力与局部 UI 状态 | 插件拥有命中、批次和定位；UI 管理输入和过期请求，不再添加转发层。 |
| 阅读历史 | 保留 installReadingHistory 生命周期入口 | 已封装校验、异步恢复竞争、防抖、持续滚动检查点和释放时写入。 |
| 渲染 / 节能 | 保留 Canvas 绘制与 SDK 调度边界 | 缓存与图块调度由 SDK 负责；运动暂停与 DPR 策略已有独立模块。 |
| 平台文件访问 | 保留 PdfFileHandle / ManagedResource | 浏览器权限、下载降级、文件版本确认、资源释放都在适配器内；不让视图访问原生文件句柄。 |
| 主题 | 保留统一主题 store 和渲染主题映射 | UI 色彩、注释策略和文档渲染需要共享主题语义，无需拆成独立状态来源。 |
| 签名 / 打印 / 保护 | 保留功能入口 | 签名导出对话框与 hook；打印复用 SDK，保护通过文档客户端操作；业务状态在各功能内部。 |
| Worker / 原生运行时 | 保留传输、宿主与原生扩展分层 | 原生 ABI、字体初始化和生命周期位于 engine；UI 经客户端访问，不扩大原生接口。 |

### 验证范围

- 文档输出测试覆盖权限先于序列化、共享保存不在 UI 重复序列化、部分字节视图、副本及取消。
- 视图测试覆盖恢复布局、旋转、fit 模式、帧等待与阅读锚点的顺序；既有测试覆盖演示导航和替换绘制等待。
- AI 测试覆盖密钥保存、端点更换、请求、流解析、用量和翻译行为。
- 目录迁移由全项目 TypeScript 检查和 Vite 生产构建验证；现有 Node 测试集检查跨模块回归。
- 本轮未运行浏览器端交互或桌面打包测试；没有修改桌面 Go 实现或安装器。

## 文件结构与浅层转发复核

- 删除 `platform/llm.ts`：完整 AI 服务收敛后，可直接判断 `platform.ai`，不再维护独立函数和对应布尔判断测试。流解析测试独立命名为 `ai-stream.test.mjs`。
- `components/select-styles.ts` 合并到 Select 组件；样式常量与其组件由同一模块维护。
- 删除 `engine/pdf-runtime.ts`：文档访问方法没有调用方，剩余能力只是转发 engine 与字体诊断。生命周期 hook 改为 `usePdfEngine`，返回 engine；诊断通过现有共享文档客户端获取。
- 查看器导航目标判断移入 `viewer-input.ts`，不再把查看器 DOM 策略放入 shared/utils。
- 复核 apps 的相对引用、测试与工具引用，以及 index.html、Vite 平台 alias、Worker URL 入口。未发现可确认孤立的应用源码文件。
- 保留 components、fonts、signatures 的目录入口：它们有实际调用方，定义功能对外可用的组件、目录或类型。
- 保留 viewport-geometry、tile-levels、ai-prompt 和 config：分别拥有坐标换算、分辨率策略、模板替换和默认配置语义，有明确使用者。

本轮类型检查、164 项 Node 测试与生产构建通过；导航策略迁移后另外复跑输入测试。没有执行发布操作。
