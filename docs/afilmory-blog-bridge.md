# Afilmory 详情与博客 Navigation 联动

博客的 `/gallery` 页面现在只负责嵌入 Afilmory，并保留底部 Navigation 与独立打开箭头。**不修改 Safari 的 `viewport-fit`、Afilmory 内部安全区或 iframe 内容**。普通画廊列表允许使用 `100lvh` 延伸到浏览器底部安全区；当照片详情打开时，外层容器自动缩为 `100svh`，不再压到 Safari 工具栏之下（旧浏览器回退 `100vh`）。iframe 本身不卸载、不重新加载。

打开大图时，仅隐藏博客的 **Navigation**；关闭大图后恢复。右侧独立打开箭头保持不变。

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
