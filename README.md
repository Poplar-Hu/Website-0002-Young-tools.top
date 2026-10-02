# tools.who-young.top — Populus Hu 在线工具箱

纯静态、**零构建步骤**的前端小工具集合。所有依赖都放在本站，不引用任何外部 CDN，
因此断网也能用，也不受境外 CDN 时快时慢的影响。

线上地址：<https://tools.who-young.top/>

---

## 目录结构

```
.
├── index.html              工具箱首页
├── markdown/index.html     Markdown 实时预览
├── mermaid/index.html      Mermaid 图表渲染
├── lang/                   语言包 cn / en / jp（87 个键）
├── assets/
│   ├── lang.js             多语言实现（与主站同一套机制）
│   ├── tools.css           共享样式（设计令牌取自主站）
│   ├── tools.js            共享脚本（导航 + 下载/复制/防抖等通用函数）
│   ├── font-awesome.min.css
│   ├── fonts/              Font Awesome 4.7.0（只保留 woff2 / woff）
│   ├── icon.ico
│   └── vendor/             本地化的第三方库，见下表
├── CNAME                   GitHub Pages 自定义域名
└── .nojekyll               阻止 Pages 用 Jekyll 处理
```

**URL 与文件路径的对应关系**：本仓库是「项目仓库 + 自定义域名」，
GitHub Pages 会把**仓库根目录映射到域名根**，所以：

| 文件 | 线上地址 |
|---|---|
| `index.html` | `https://tools.who-young.top/` |
| `markdown/index.html` | `https://tools.who-young.top/markdown/` |
| `mermaid/index.html` | `https://tools.who-young.top/mermaid/` |

> 注意：不能把这些文件放进 `tools/` 子目录，否则地址会变成 `.../tools/markdown/`。

---

## 本地预览

页面里用的是根路径（`/assets/...`），所以**必须从仓库根目录起服务**，
不能直接双击打开 HTML：

```bash
cd Website-0002-Young-tools.top
python -m http.server 8080
# 然后访问 http://localhost:8080/
```

---

## 部署

**这个仓库不需要 GitHub Actions** —— 没有构建步骤，直接用分支部署即可：

```
Settings → Pages → Build and deployment → Source
  → Deploy from a branch
  → Branch: main   /   (root)
```

因为仓库里没有任何敏感内容（就这几个静态文件），整仓库发布是安全的。

`CNAME` 文件的内容必须与 Settings 里的 Custom domain 一致（都是 `tools.who-young.top`），
不一致会导致域名反复掉。

---

## 本地化的第三方库

| 文件 | 来源 | 大小 |
|---|---|---|
| `vendor/mermaid.min.js` | `npm/mermaid@11.4.1/dist/mermaid.min.js` | 2.5 MB |
| `vendor/marked.min.js` | `npm/marked@12/marked.min.js` | 35 KB |
| `vendor/purify.min.js` | `npm/dompurify@3/dist/purify.min.js` | 28 KB |
| `vendor/highlight.min.js` | `npm/@highlightjs/cdn-assets@11/highlight.min.js` | 126 KB |
| `vendor/github.min.css` | `npm/@highlightjs/cdn-assets@11/styles/github.min.css` | 1.3 KB |

Font Awesome 4.7.0 复制自主站 `Website-0001-Young-main.top/src/`。

### 为什么不用 CDN

实测（大陆直连，Clash 系统代理模式，见主站 `deploy/README.md` 的方法）：

| 资源 | 从 jsDelivr 加载 |
|---|---|
| marked（35 KB） | 0.4 s |
| highlight.js（126 KB） | 1.4 s |
| **mermaid（2.5 MB）** | **43~70 s** |

小文件没问题，但 mermaid 这种体积的包从 CDN 拉要**将近一分钟**，页面会一直卡着。
本地化之后由 GitHub Pages 同一个源提供，并受浏览器缓存，二次访问几乎瞬时。

### 升级某个库

```bash
# 例：换 mermaid 版本（注意这个下载可能要等一分钟）
curl -o assets/vendor/mermaid.min.js \
  https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js
# 用 head 确认下下来的不是 HTML 错误页
head -c 80 assets/vendor/mermaid.min.js
```

> ⚠️ `highlight.js` 要认准 `@highlightjs/cdn-assets` 这个包。
> `highlight.js/lib/common.min.js` 不是浏览器可用的构建 ——
> 它只是 `require()` 列表，直接引用会得到一个 2.6 KB 的空壳。

---

## 多语言（i18n）

与主站 `who-young.top` 是**同一套机制**：

| 组成 | 位置 |
|---|---|
| 唯一实现 | `assets/lang.js` |
| 文案 | `lang/cn.json` / `lang/en.json` / `lang/jp.json`（87 个键） |
| 标记 | HTML 上写 `data-i18n="键名"`；输入框占位符写 `data-i18n-placeholder="键名"` |
| 选择器 | `.language-selector` 类；页眉（桌面端）、移动端菜单、页脚各一个 |

**兜底策略**：HTML 里直接写中文原文，语言包到达后原地替换。
所以禁用 JS 或语言包加载失败时，页面仍是完整中文，搜索引擎也能抓到内容。

### 与主站的三处差异

1. **语言包路径用根路径 `/lang/`**。工具页在 `/markdown/` 这样的子目录下，
   相对路径会被解析成 `/markdown/lang/...`。
2. **支持 `?lang=en` URL 参数**，优先级高于 localStorage 和浏览器语言，
   便于分享指定语言的链接。
3. **多了两个给 JS 用的接口**：
   - `window.i18n.t(key, vars, fallback)` —— 取动态文案，支持 `{name}` 占位符
   - `window.i18n.onReady(fn)` —— 语言包就绪时回调，**每次切换语言都会再触发**

### ⚠️ 最容易踩的坑

`i18n.t()` 在语言包到达前只能返回兜底字符串。所以**凡是用 JS 写进 DOM 的动态文案**
（字数统计、空状态、错误提示），都必须额外在 `i18n.onReady()` 里重渲染一次：

```js
if (window.i18n) i18n.onReady(() => { lastHtml = null; render(); });
```

否则切换到英文后，这些文字会一直停在中文 —— 页面看着"翻译了一半"。
Mermaid 页的模板下拉同理，靠 `onReady` 重建 `<option>` 文字。

### 改文案的流程

1. 改 `lang/cn.json`，同时改 `en.json` 和 `jp.json`
2. **键名与 `{}` 占位符三份必须完全一致**（否则会静默取不到值）
3. 页面里 `i18n.t('键', { … }, '中文兜底')` 的兜底文字顺手同步
4. 页面里 `data-i18n` 元素的**中文原文**也顺手同步（那是给无 JS 环境的兜底）

### 验证方法

用无头浏览器截图验证 i18n 有个陷阱：**截图发生在 `load` 事件附近，
而语言包是异步 fetch 的，往往还没返回**，截出来就是中文兜底，误判成"没生效"。

可靠做法是把 `load` 人为推后 —— 页面里放一张指向慢端点的图片，
让截图发生在语言包渲染之后。见仓库外的 `_slowserver.py` + `_mkshots.mjs` 思路。

---

## 新增一个工具

1. 新建目录 `你的工具名/index.html`
2. 从现有页面复制 `<head>` 与导航/页脚结构（`assets/tools.css` 已经提供了
   `.tool-card-main` / `.tool-bar` / `.panes` / `.pane` / `.editor` / `.preview`
   这些现成的布局类）
3. 在 `index.html` 首页加一张卡片
4. 在三个页面的导航里都加一条链接

---

## 设计约定

样式刻意对齐主站 `who-young.top`：

- 背景渐变 = 主站 `src/css.css` 的 `.index-bg-pattern`
- 颜色令牌 = 主站 `tailwind.config.js` 的 `theme.extend.colors`
- 导航栏装饰线、卡片悬停位移、链接下划线动画都与主站一致
- 字体栈与主站相同（含 `PingFang SC` / `Microsoft YaHei` 回退）

主站用的是 Tailwind 构建产物，本仓库为了**免去构建步骤**改为手写 CSS 并复用同一套令牌。
如果以后想统一成 Tailwind，需要补上 `package.json` + 构建 + Actions 部署。
