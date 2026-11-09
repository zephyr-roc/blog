# Afilmory 详情与博客 Navigation 联动

博客的 `/gallery` 页面嵌入 Afilmory。普通瀑布流直接使用 `100lvh`（旧浏览器回退 `100vh`）填满浏览器的大视口；**打开照片详情时**三层容器同步缩为 `100svh`，以避开 Safari 的地址栏/底部工具栏。关闭大图后同步恢复 `100lvh`。

特别注意：`gallery-shell`、`gallery-embed` 与 iframe **分别使用明确的视口高度**，不再使用 iframe 的 `height: 100%` 百分比高度继承，因为 WebKit 对嵌套 iframe 的百分比高度存在过计算异常。这样普通浏览不会只渲染半屏，同时大图中的缩略图和直方图保留在安全可视区域。iframe 不卸载、不重新加载。

打开大图时同时隐藏博客 **Navigation** 和右侧 **独立打开箭头**，并设为 `inert`；关闭详情后两者恢复。

博客 `/gallery` 页面和**经来源校验的嵌入式 Afilmory 文档**都启用 `viewport-fit=cover`，以允许瀑布流尽可能延伸到 Safari 安全区域。桥接脚本只修改嵌入文档的 viewport 元数据，不更改图片栅格、`pb-20`、Afilmory 的滚动方式或独立窗口的布局。照片详情依旧由博客容器限制为 `100svh`，保护缩略图和直方图。iOS Safari 的跨域 iframe 合成层可能仍有裁切限制，必须真机确认绘制范围。

## Afilmory 必须加载桥接脚本

`nas.afilmory.ready-jump.top` 与博客不同源，博客**无法自行读取 iframe 内的 URL 或照片详情状态**。必须在 NAS 自建 Afilmory 的 HTML 模板／可持久化启动补丁中注入：

```html
<script src="https://www.ready-jump.top/afilmory-embed-bridge.js"></script>
```

这行脚本必须出现在 **Afilmory 实际返回的 HTML** 中，不能只放到博客页面。升级 Afilmory 时需保留注入方式。脚本只汇报 `/photos/:photoId` 是否打开，不修改任何布局或内边距。


**Safari 关键点：** 建议把上面的脚本放在 NAS Afilmory HTML 的 `<head>` 中，紧跟 `<meta name="viewport" ...>` 之后、Afilmory 应用脚本之前，并**不要加 `defer`**。这样可尽早设置嵌入文档的 `viewport-fit=cover`，避免先用非全屏视口布局再调整。原站独立打开时脚本立即退出，不改变它的显示方式。现有 `defer` 注入如无法调整，也可以先验证，但 Safari 首次绘制可能已采用旧视口。

验证时，请在浏览器开发工具中切到 Afilmory iframe 上下文，运行 `document.querySelector('meta[name="viewport"]')?.content`：嵌入时应包含 `viewport-fit=cover`；直接打开 Afilmory 时不应被桥接脚本修改。如果父页面 `document.body.dataset.galleryBridgeReady` 仍为 `"false"`，说明 NAS 尚未加载或成功执行桥接脚本。

## 验证

在 Afilmory iframe 执行上下文中运行 `window.__BLOG_GALLERY_BRIDGE__`，预期为 `true`。

在博客父页面控制台中运行 `document.body.dataset.galleryBridgeReady`，预期为 `"true"`。打开照片时 `document.body.dataset.galleryViewerOpen` 应变为 `"true"`，关闭后恢复为 `"false"`。

如果脚本未注入，Navigation 无法根据跨域 iframe 的照片状态隐藏。不要通过 iframe 点击或获得焦点推断照片已打开，这会误隐藏普通画廊浏览时的 Navigation。
