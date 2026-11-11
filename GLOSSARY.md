# 项目术语约定

本文用于代码、问题描述和设计讨论。英文标识与代码对应；讨论中避免单独使用「版本」「保存」「文档 ID」而不说明具体含义。

## 文档与身份

| 术语 | 约定含义 |
| --- | --- |
| PDF 文件 / original | 磁盘或浏览器文件系统中的原始 PDF 字节；不包含尚未保存的编辑。 |
| PlatformDocument | 平台提供的打开结果，组合资源、文件写入能力、可选阅读记录键和外部变更监听。 |
| ManagedResource | 可读取资源的地址、可选流与释放能力；资源 URL 不等于稳定文件身份。 |
| sharedIdentity / 文件身份 | 用来判断是否同一个文件的字符串或 FileSystemFileHandle。文件句柄用 isSameEntry 比较，不能仅比较文件名。 |
| documentId / sessionKey | Worker 中打开文档会话的标识。当前共享状态中二者值相同；不是文件路径或内容哈希。 |
| 共享文档 | 同一文件身份且匹配已知内容版本的会话，跨标签共享编辑和历史；同一文件的不同内容版本可以拥有不同会话。 |
| documentKey / 阅读记录键 | 平台用于保存阅读位置的键，不应替代共享文件身份。 |
| tab / 标签页 | 独立 UI、导航、选择和渲染缓存的拥有者。 |

## 版本与持久化

| 术语 | 约定含义 |
| --- | --- |
| revision / 编辑修订号 | 会话内编辑状态的递增计数，不是 PDF 内容哈希。 |
| savedRevision | 已确认写回原文件的编辑修订号；其后的编辑仍未保存。 |
| diskVersion | 保存协调器所认定的原 PDF 内容版本，用于防止覆盖外部修改。 |
| candidateVersion | 正在保存的输出内容哈希，用于识别保存期间重新打开的输出。 |
| Save to PDF / 保存 | 序列化完整 PDF，并由写入方确认原文件版本；成功下载副本不等于原文件已保存。 |
| copy / 副本 | 独立导出结果，不推进原文件的 diskVersion 或 savedRevision。 |
| PdfWritePlan / 写入计划 | Worker 提供的目标、PDF 字节、预期原版本和输出版本。平台执行计划并返回 PdfWriteResult。 |
| SaveLane / 保存通道 | 同一文件相关会话共享的 FIFO，串行处理保存和排队的草稿写入，包含操作清理；独立于原生引擎队列。 |
| draft / 草稿 | 注释和受支持表单值的恢复记录；桌面为 `.swp`，浏览器使用本地私有存储。不是完整 PDF 或备份。 |
| baseVersion | 草稿所依附的原 PDF 版本；恢复时必须匹配。 |
| draftRevision | 草稿已持久化的编辑修订号，不表示原 PDF 已保存。 |
| draft storage version / 草稿存储版本 | 存储层用于比较并交换（CAS）的令牌；与 baseVersion、revision 分开使用。 |
| merge / 合并保存 | 将编辑写入完整 PDF，并清理或重建草稿；mergeOutputVersion 用于识别已完成写回的遗留草稿。 |
| baseline / 草稿基线 | 原始注释、表单和页面快照，用于计算净变化。 |
| conflict / 冲突 | 预期文件或草稿版本不匹配；不得静默覆盖。 |

## 引擎与显示

| 术语 | 约定含义 |
| --- | --- |
| platform / 平台适配器 | 浏览器、扩展或桌面启动器的文件、权限、偏好和外部服务访问边界。 |
| launcher / 启动器 | desktop/ 中的 Go 桌面入口和本地后台服务，负责本地文件访问及浏览器启动；launcher 是历史名称及部分协议命名。 |
| host / 文档宿主 | Worker 中权威文档状态、历史和持久化协调的拥有者。 |
| client / 文档客户端 | 标签页访问 Worker 文档能力的入口。 |
| native runtime / 原生运行时 | Worker 内 PDFium WASM 及其生命周期；不等同于 Worker 本身。 |
| native queue / 引擎队列 | 串行执行原生文档操作；不得为等待磁盘或页面响应而长期占用。 |
| Stage / 舞台 | EmbedPDF 的视口、页面布局和交互坐标体系。 |
| raster / 栅格 | 页面渲染产生的像素数据；base raster 是基础图像，tile 是局部高分辨率图块。 |
| CanvasRenderLayer | 标签页绘制基础图像和图块的呈现层。 |
| pageIndex / pageNumber | 前者为从 0 开始的内部页索引；后者为从 1 开始的用户页码。 |
| PDF point / PDF 点 | 文档坐标单位；不得与 CSS 像素或设备像素混用。 |
| DPR | 设备像素与 CSS 像素比例，影响呈现分辨率。 |
| transferable buffer / 可转移缓冲区 | 通过转移所有权跨 Worker 传递的字节；转移后发送方不能再次使用原缓冲区。 |
| Deep Module / 深模块 | 用小而明确的能力接口封装完整策略和不变量；调用方不需要维护内部队列、缓存或事务步骤。 |

新增概念时先明确所属层、身份与生命周期；同一概念沿用此表名称。实现细节见 [接口边界](docs/interfaces.md) 与 [渲染说明](docs/rendering.md)。

## 功能能力接口

- **AiService**：完整的可选 AI 能力，统一请求、读取配置和修改配置。平台的 `ai` 缺失表示不支持，不能以单个方法缺失表示部分可用。
- **DocumentOutput**：由 `createDocumentOutput` 创建、绑定一次文档上下文的输出能力，封装保存、导出、副本所需的序列化和写入准备。
- **ViewCheckpoint**：文档替换时捕获的临时视图状态，包含布局、缩放、旋转、模式及阅读锚点；不是持久化阅读记录或 PDF 编辑状态。
