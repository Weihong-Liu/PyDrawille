# Image2Braille Web

一个完全在浏览器里运行的图片→盲文点阵在线工具。零后端,所有处理都在用户本地完成。

## 本地预览

任意一个能 serve 静态目录的工具都行,因为加载样图时浏览器要走 HTTP 而不是 `file://`:

```bash
cd web
python3 -m http.server 8000
# 然后浏览器打开 http://localhost:8000
```

## 部署到 GitHub Pages

仓库根目录的 `web/` 不是 GitHub Pages 默认识别的路径(默认认 `/` 或 `/docs`),三种部署方式任选:

### 方式 1 - 把 `web/` 改名为 `docs/` 并在仓库设置启用

```bash
mv web docs
git add docs && git commit -m "deploy web app via /docs"
git push
```

然后在 GitHub 仓库 Settings → Pages → Source 选 **Deploy from a branch**,
Branch 选 `main` + `/docs`,保存即可。访问 `https://<user>.github.io/<repo>/`。

### 方式 2 - 用 GitHub Actions 部署 `web/`

在仓库添加 `.github/workflows/pages.yml`:

```yaml
name: Deploy web/ to Pages
on:
  push:
    branches: [main]
permissions:
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./web
      - id: deployment
        uses: actions/deploy-pages@v4
```

仓库 Settings → Pages → Source 选 **GitHub Actions**。

### 方式 3 - 推到独立的 `gh-pages` 分支

```bash
git subtree push --prefix web origin gh-pages
```

仓库 Settings → Pages → Source 选 `gh-pages` 分支根目录。

## 文件结构

```
web/
├── index.html       界面布局
├── styles.css       暗色主题与组件样式
├── app.js           盲文转换算法 + UI 逻辑(纯 vanilla JS,零依赖)
├── samples/         一键加载的样图
│   ├── wheel.png
│   └── wings.png
└── README.md        本文件
```

## 算法对应

| Web 端 (`app.js`)        | Python 端                                  |
| ------------------------ | ------------------------------------------ |
| `brailleSubpixel()`      | `image_to_braille.image_to_canvas()` + `CanvasSurface.dump()` |
| `brailleDensity()`       | `image_to_braille.image_to_density()`      |
| `floydSteinberg()`       | PIL `Image.convert("1")` 默认抖动          |
| `interpolateColors()`    | `image_to_braille.interpolate_colors()`    |
| `buildTaggedText()`      | `image_to_braille.colorize()`              |

输出的"原始 txt"格式是 `[#hex]...[/]` 行级标签,可以直接喂给 Python 的
`rich.Console().print(text, highlight=False)` 在真终端看到彩色。
