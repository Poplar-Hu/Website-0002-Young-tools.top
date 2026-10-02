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
├── brainfuck/index.html    Brainfuck 编辑器 + 优化解释器
├── codec/index.html        编码 / 解码工具箱（配方链）
├── lang/                   语言包 cn / en / jp（170 个键）
├── test/                   引擎测试（node 直接跑，不依赖浏览器）
├── assets/
│   ├── lang.js             多语言实现（与主站同一套机制）
│   ├── bf.js               Brainfuck 引擎（解析 / 优化 / 解释 / JIT）
│   ├── codec.js            编解码引擎（32 个操作 + 配方执行）
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
| `brainfuck/index.html` | `https://tools.who-young.top/brainfuck/` |
| `codec/index.html` | `https://tools.who-young.top/codec/` |

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

可靠做法是把 `load` 人为推后 —— 给页面注入一张指向慢端点的图片，让截图发生在
语言包渲染之后。具体做法：本地起一个「sleep 2.5 秒再返回 1×1 GIF」的静态服务器，
再把 `<img src="/__slow">` 注入到页面**最后一个** `</body>` 之前（注意别用
`String.replace` 的字符串形式 —— 它只替换第一处，而这个页面里还有一个
`</body>` 藏在「导出 HTML」的 JS 模板字符串里，会注进字符串内部）。

---

## Brainfuck 引擎（`assets/bf.js`）

`/brainfuck/` 用的引擎，分三层，刻意把「优化」做成**可量化**的东西：

| 层 | 做什么 |
|---|---|
| `parse` | 源码 → 扁平 IR，顺手把连续的 `+ - < >` 合并成一条 |
| `optimize` | IR → 树 → 多趟 peephole → 再拍平。**树化之后重写很安全**，跳转目标自动重算，不用手工维护下标 |
| `runIR` / `compile` + `runJIT` | 后端 A：在 IR 上解释执行；后端 B：把 IR 生成 JS 源码再 `new Function` 编译 |

### 实现了这些优化

| 惯用法 | 折叠成 |
|---|---|
| `+++` `>>>` | 一条 `ADD 3` / `RIGHT 3` |
| `[-]` `[+]` | `CLEAR` |
| `[->+<]` `[->++>+++<<]` | `XFER`（多目标传输） |
| `[>]` `[<<]` | `SCAN`（沿一个方向走到值为 0 的格子） |
| `[-]+++` | `SET 3`（常量折叠） |
| 连续赋值、被覆盖的加减 | 直接删除（死存储消除） |

实测：Hello World `59 → 46` 条，谢尔宾斯基三角形 `76 → 49` 条、执行步数 29586 → 25024。

### 为什么 JIT 能快一个数量级

BF 的 `[ body ]` 语义**正好就是** JS 的 `while (cell) { body }`，所以可以直接生成嵌套的
原生 while，交给 V8 去优化。实测「约 670 万步」的基准程序：解释执行 ~100–145 ms，JIT ~7–9 ms，
**约 10–20 倍**（同一台机器上多次运行会落在这个区间，V8 的即时编译本身也有波动）。

### 一个刻意的设计：步数上限只在循环边界检查

不是在每条指令上查，而是只在 `JZ` / `JNZ` 处查。这样 JIT 后端能用同样稀疏的检查点，
**两个后端在相同 `maxSteps` 下必定产出逐字节相同的输出**。否则撞上限时 JIT 会多跑完
一整个循环体，两边截断位置不同 —— 页面上并排显示两个结果时，看起来就像其中一个算错了。

安全性不受影响：任何死循环都必然经过 `JNZ`。

### 测试

引擎不依赖 DOM，`node` 里直接 `import` 这个文件就能用（挂在 `globalThis.BF` 上），
所以能脱离页面做真正的测试：

- **6 个示例程序**逐个验证输出：Hello World / cat / 打印 0-9 / 两数相加 / 谢尔宾斯基三角形 / 性能基准
- **11 条优化规则**逐条断言，包含**反向**断言：当前格净减 2 的循环*不能*被折叠
  （它跑的不是 value 次，折叠会算错）
- **1000 个随机程序的差分测试**：优化前后的输出必须一致、JIT 与解释器必须逐字节一致
- 解释器 vs JIT 的耗时对比

跑一遍（不需要任何依赖）：

```bash
node test/bf.test.mjs        # Brainfuck 引擎，26 项
node test/codec.test.mjs     # 编解码引擎，108 项
```

> 注意：这个仓库用「从分支部署」，所以 `test/` 也会被发布出去。都是纯源码，无所谓；
> 介意的话可以在 Pages 设置里改用 Actions 部署并过滤掉它。

---

## 新增一个工具

1. 新建目录 `你的工具名/index.html`
2. 从现有页面复制 `<head>` 与导航/页脚结构（`assets/tools.css` 已经提供了
   `.tool-card-main` / `.tool-bar` / `.panes` / `.pane` / `.editor` / `.preview`
   这些现成的布局类）
3. 在 `index.html` 首页加一张卡片
4. 在**所有页面**的导航与页脚里都加一条链接（现在有 4 个工具页 + 首页）

---

## 编解码引擎（`assets/codec.js`）

`/codec/` 用的引擎。和 Brainfuck 那套的取舍不同：那边拼的是解释器与编译器，
这边拼的是**多种编码的正确实现**与**可串联的流水线**。

### 配方（recipe）模型

数据是「文本进、文本出」，每个操作签名统一为 `run(text, params) -> string | Promise<string>`。
需要字节时内部临时转 UTF-8，因此链式组合天然成立 ——
`Base64 解码 → URL 解码` 这种两层嵌套就是两步的事。

摘要类操作是异步的（`crypto.subtle`），所以 `runRecipe` 本身就是 async；
出错时默认抛出（带 `step` 索引），传 `{ throwOnError: false }` 则返回出错前的结果，
页面据此既能指出卡在第几步、又不丢掉已算出的部分。

### 32 个操作

| 分类 | 内容 |
|---|---|
| Base 编码 | Base64（含 URL 安全 / 可选补 `=`）、Base32、Base58、十六进制（大小写 / 空格分组） |
| 文本编码 | URL（component / 整串）、HTML 实体、Unicode 转义（含星平面拆代理对）、二进制表示 |
| 古典密码 | ROT13、ROT-N、ROT 暴力枚举（26 行）、Atbash、摩尔斯、栅栏密码、维吉尼亚 |
| 摘要 / 校验 | CRC32、MD5（自实现）、SHA-1 / SHA-256 / SHA-512（Web Crypto） |
| 其他 | JWT 解码（含 exp 过期判断） |

> Web Crypto 不支持 MD5，所以那一份是照着 RFC 1321 直译的 —— 测试里用
> 55 / 56 / 64 字节这几个补位边界专门验过。

### 测试

```bash
node test/codec.test.mjs     # 108 项
```

- **已知向量**：RFC 4648 附录 A 的 Base64 / Base32 全部 7 组、Base58 的 bitcoin 字母表、
  维吉尼亚的教科书例（ATTACKATDAWN + LEMON）、CRC32 标准值、MD5 的 RFC 向量与补位边界、
  SHA-1 / 256 / 512 的 `"abc"` 向量
- **往返测试**：11 种编码 × 12 个刁钻样本（空串 / 中文 / emoji / 空白 / 长串）
  ＋ 每种再跑 300 个随机字符串
- **配方**：两步链的结果、空配方、JWT 示例的解析
- **错误处理**：每个错误码都断言到具体 code 与 step 索引
- **注册表自检**：id 不重复、分类有效、每个操作都有 cn/en/jp 名称、示例配方都能跑通

> 随机字符串里**刻意跳过 U+D800–DFFF 代理区**：孤立代理项是非法 Unicode，
> UTF-8 编码时会变成 U+FFFD，那种字符串本来就不可逆，考验不了这些编解码器。

---

## 设计约定

样式刻意对齐主站 `who-young.top`：

- 背景渐变 = 主站 `src/css.css` 的 `.index-bg-pattern`
- 颜色令牌 = 主站 `tailwind.config.js` 的 `theme.extend.colors`
- 导航栏装饰线、卡片悬停位移、链接下划线动画都与主站一致
- 字体栈与主站相同（含 `PingFang SC` / `Microsoft YaHei` 回退）

主站用的是 Tailwind 构建产物，本仓库为了**免去构建步骤**改为手写 CSS 并复用同一套令牌。
如果以后想统一成 Tailwind，需要补上 `package.json` + 构建 + Actions 部署。
