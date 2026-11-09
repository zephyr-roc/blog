# Afilmory 详情与博客 Navigation 联动

博客的 `/gallery` 页面嵌入 Afilmory。普通瀑布流直接使用 `100lvh`（旧浏览器回退 `100vh`）填满浏览器的大视口；**打开照片详情时**三层容器同步缩为 `100svh`，以避开 Safari 的地址栏/底部工具栏。关闭大图后同步恢复 `100lvh`。

特别注意：`gallery-shell`、`gallery-embed` 与 iframe **分别使用明确的视口高度**，不再使用 iframe 的 `height: 100%` 百分比高度继承，因为 WebKit 对嵌套 iframe 的百分比高度存在过计算异常。这样普通浏览不会只渲染半屏，同时大图中的缩略图和直方图保留在安全可视区域。iframe 不卸载、不重新加载。

打开大图时同时隐藏博客 **Navigation** 和右侧 **独立打开箭头**，并设为 `inert`；关闭详情后两者恢复。

不修改 `viewport-fit`、Afilmory 内部 CSS、安全区或照片内容，也不通过屏幕尺寸 JavaScript 强行拉伸 iframe。

## Afilmory 必须加载桥接脚本

`nas.afilmory.ready-jump.top` 与博客不同源，博客**无法自行读取 iframe 内的 URL 或照片详情状态**。必须在 NAS 自建 Afilmory 的 HTML 模板／可持久化启动补丁中注入：

```html
<script defer src="https://www.ready-jump.top/afilmory-embed-bridge.js"></script>
```

这行脚本必须出现在 **Afilmory 实际返回的 HTML** 中，不能只放到博客页面。升级 Afilmory 时需保留注入方式。脚本只汇报 `/photos/:photoId` 是否打开，不修改任何布局或内边距。

## 验证

在 Afilmory iframe 执行上下文中运行 `window.__BLOG_GALLERY_BRIDGE__`，预期为 `true`。

在博客父页面控制台中运行 `document.body.dataset.galleryBridgeReady`，预期为 `"true"`。打开照片时 `document.body.dataset.galleryViewerOpen` 应变为 `"true"`，关闭后恢复为 `"false"`。

如果脚本未注入，Navigation 无法根据跨域 iframe 的照片状态隐藏。不要通过 iframe 点击或获得焦点推断照片已打开，这会误隐藏普通画廊浏览时的 Navigation。
