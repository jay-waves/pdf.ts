# 桌面服务与构建重构

约束：保留系统浏览器、同源标签页共享编辑和 Go 文档服务。平台原生代码仅处理系统集成，文件保存与草稿规则保持一份实现。

## 交付清单

- [x] Windows 文件锁、替换、错误提示使用 x/sys/windows 类型化接口；未封装的 AttachConsole 使用 NewLazySystemDLL。
- [x] web、Chrome、桌面平台共享 browserCapabilities，平台入口只覆盖差异。
- [x] launcher 明确为 desktop 服务目录；macOS Swift 运行时入口归入 desktop。
- [x] 打包统一入口拥有目标解析、编译与装配顺序；package.json 与 CI 复用。
- [x] Go 嵌入资源与 Windows syso 在隔离工作区生成，不改写源码目录。
- [x] 更新测试、CI、文档路径，验证打包失败清理与构建隔离。

保留平台安装资源格式（NSIS / nFPM / plist）和已有产物名称。重构不发布产物、不更改文件协议或迁移用户数据。

统一入口：`node packaging/build.mjs linux [deb rpm | binary]`、`windows [exe | binary]`、`macos [dmg | binary]` 或 `chrome`。未传格式时生成该平台默认安装包。入口消费现有 release/web；平台脚本是内部步骤。

Go 源码复制至独立临时模块，关闭 VCS 采集与外部 go.work；嵌入压缩资源和 syso 仅在该目录生成，成功与失败均清理。不同目标不共享临时资源；相同目标的发布输出仍应串行构建。

## 当前职责边界

- `apps/platform/browser-capabilities.ts`：浏览器共有的偏好、AI、本地打开与外部链接行为。平台适配器只覆盖来源和特殊行为。
- `apps/platform/launcher.ts`：浏览器端本地服务协议客户端，保留既有 URL / 参数以兼容已打开的文档。
- `desktop/`：Go 文档服务、文件与草稿事务、后台生命周期和系统调用。Windows 优先使用 x/sys/windows 类型化封装。
- `desktop/macos/main.swift`：登录项与系统入口；不拥有文档业务规则。
- `packaging/`：目标编排与平台安装资源；`scripts/package-*` 为内部工具适配步骤。

## 验证记录

- 165 项 Node 测试通过，包含统一入口的顺序、格式去重、非法参数和失败中止，以及临时工作区隔离与清理。
- TypeScript 检查与 Vite 生产构建通过；构建仍提示部分 JS chunk 超过 500 kB。
- `go test ./desktop` 通过；真实 Chrome 的 `TestDraftBrowser` 通过。
- Windows amd64 与 macOS arm64 的 Go 测试程序交叉编译通过。这不等于在对应系统执行测试。
- `packaging/build.mjs linux binary` 通过，产物保持 `release/pdf.ts`。
- 本机未执行 Windows/macOS 原生安装验证、macOS Swift 编译或完整 deb/rpm/NSIS/DMG 生产打包；已有平台 CI 的安装校验步骤保留，构建步骤统一调用新入口。
