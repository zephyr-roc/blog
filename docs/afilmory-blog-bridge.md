# Afilmory 详情与 Blog 底栏联动

Blog 的 iframe 接收端已支持：照片详情打开时隐藏导航与独立打开按钮，关闭时恢复。当前 Afilmory 页面未发送状态事件，所以需要在 **NAS 的 Afilmory HTML 模板**（现有自建启动补丁中）加入一次：

```html
<script defer src="https://www.ready-jump.top/afilmory-embed-bridge.js"></script>
```

放在 Afilmory 的应用脚本附近即可。应修改自建启动补丁或服务端 HTML 模板，让容器更新后仍保留；不要只手改一次运行中容器的文件。此脚本随 Blog 发布，直接在新窗口打开 Afilmory 时不会执行联动逻辑。

脚本根据当前 Afilmory 的 `/photos/:photoId` 路由，在 pushState、replaceState 和返回/前进时通知父窗口。不轮询照片、不传图片或个人信息，只发送打开/关闭状态。只向 ready-jump.top / www.ready-jump.top 发送通知；Blog 校验来源域名、iframe 窗口、协议版本和布尔字段。

验收：从 Blog 进入画廊，点照片后底栏和箭头淡出；关闭详情、浏览器后退后恢复。刷新 iframe 或从照片链接直接进入时也应同步状态。升级 Afilmory 若更改照片路由，需要同步更新桥接脚本。

没有安装这行脚本时，Blog 保持底栏可见，避免把普通画廊点击误判成打开详情。
