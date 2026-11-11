# 开发检查与脚本归属

## 日常流程

- `pnpm check`：类型检查与 Node 测试。默认不启动浏览器、下载浏览器或访问外部字体。
- UI、Worker 或文件流程改动：先 `pnpm dev`，再 `pnpm test:browser <分组或检查名>`。不带参数只运行 smoke；`--list` 列出入口。可以同时选择多个分组，重复检查只运行一次。
- `PDF_TEST_URL` 指向已有 Vite **开发服务器**，默认 `http://127.0.0.1:5173`。部分检查动态导入源码，不支持静态 preview 替代。
- 浏览器检查复用 `/home/jay-waves/.local/lib/node_modules/playwright` 和系统 Chrome，不向项目安装 Playwright。单项检查最多运行 180 秒，失败即停止。

| 分组 | 用途 |
| --- | --- |
| smoke | Canvas 页面绘制及综合查看器功能 |
| interaction | 右键菜单、平移、平滑滚动、触摸 |
| persistence | 草稿、外部更新、阅读历史 |
| shared | 注释同步、共享编辑、PDFium RPC、跨标签保存、空闲释放 |
| rendering | Canvas、节能运动和字体回退；字体检查需 `PDF_TEST_FONT` 或脚本默认系统字体 |

例如：`pnpm test:browser document-reload`。按改动选最小范围；无需每次运行全部分组。

桌面草稿端到端检查由 Go 测试负责启动服务和临时文件：

```sh
PDF_TS_BROWSER_TEST=1 go test ./desktop -run '^TestDraftBrowser$' -count=1
```

其 `tests/browser/check-draft-launcher.mjs` 是内部子进程，不加入通用浏览器分组，也不要手动传入真实工作文件。

## 文件归属与处理结论

原 scripts 下 34 个文件调整为：

| 位置 | 数量 | 处理 |
| --- | ---: | --- |
| `scripts/` | 10 | 保留构建、发布、图标生成和安装包校验入口 |
| `tests/browser/` | 17 个检查 + 1 个运行器 | 浏览器检查纳入显式、按功能选择的流程 |
| `tests/support/` | 3 | 两个 PDF fixture 和共享文档 harness，供 Node / 浏览器 / Go 测试使用 |
| `tools/diagnostics/` | 4 | 性能对比和内存审计，手动运行，不作为常规通过门槛 |

### scripts 中保留什么

- `package-{chrome,launcher,linux,macos,windows}`：由 `packaging/build.mjs` 编排，package.json 和发布 CI 只调用统一入口。
- `verify-{macos,windows}-package`：由对应平台的发布 CI 校验真实安装包。
- `release.sh`：人工发布入口，校验版本与工作树后推送分支和 tag；具有远端写入副作用，不加入测试流程。
- `publish-release.sh`：发布 CI 上传产物的步骤，与发起 release 不同。
- `generate-icons.go`：修改品牌图标时重新生成各平台资源；按需执行，不必每次构建运行。

### 诊断工具为何保留

- `compare-canvas-rendering.mjs`：对照原始 RGBA 和编码图像路径的像素与时间；不是已移除的 UI 渲染模式开关。
- `compare-tile-strategies.mjs`：合成负载比较分辨率阶梯、请求量与缓存；不是实际滚动性能结论。
- `check-client-memory.mjs`：Chrome GC / WeakRef 和客户端私有集合审计。
- `check-static-memory.mjs`：Node / PDFium 原生缓存生命周期审计，需要 `node --expose-gc` 才有显式 GC。

内存工具依赖 SDK 内部字段，升级依赖时需重新审查；它们不能替代真实浏览器 RSS 测量。

### 删除了什么，没删除什么

删除旧路径，不保留同名转发脚本；移除已失效的 `pdfRenderer=bmp` 参数，统一临时开发端口。
本轮没有删除独有检查或诊断算法：现有证据不足以认定它们被其他测试完整覆盖。以后只有在覆盖迁移完成、实验问题已失去价值或调用方已消失时才删除，不能仅因未进入 CI 就认定无用。

新增文件应归入上述目录，并接入对应入口或写明手动运行条件；避免继续向 scripts 根目录增加功能回归脚本。

## 桌面构建

先生成 `release/web`，然后使用 `pnpm package:linux`、`pnpm package:windows` 或 `pnpm package:macos`。
直接入口为 `node packaging/build.mjs <chrome|linux|windows|macos>`；`linux deb` / `linux rpm` 可只生成一种安装包，`linux binary` / `windows binary` / `macos binary` 只编译本地服务。
平台与工具要求保持不变，macOS 在 Apple Silicon 上构建。不要在同一工作树并发构建同一个目标输出。

源码职责、隔离构建和验证范围见 [桌面重构说明](desktop-refactor.md)。
