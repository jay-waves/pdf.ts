# pdf.ts Extension

美观的 PDF 插件，基于 EmbedPDF。同时支持 VSCode 以及 Chrome 浏览器。

## 构建

```bash
# 保持原有 Chrome 扩展构建
pnpm build:chrome
pnpm package:chrome

# 构建只读的 VS Code 扩展，或直接生成可安装的 VSIX
pnpm build:vscode
pnpm package:vscode
```

<img src="./screenshot.png" width=300/>
