# 固定卡片画布设计（Fixed Card Canvas）

日期：2026-08-12

## 目标

卡片及内部组件的大小和位置完全固定，不随响应式断点变化；响应式只负责卡片整体的大小和位置。屏幕变窄时整张卡等比缩小，内部版式在任何视口下与桌面端完全一致。

## 方案

以 690px 卡宽为基准设计稿，使用容器查询单位 `cqw` 表达卡片内部一切尺寸：

- `.card-perspective` 增加 `container-type: inline-size`，成为查询容器（其宽度 `min(100%, 690px)` 不变，是响应式唯一控制点）
- 卡片内部所有 px / clamp() 值按 `px ÷ 690 × 100` 转为 `cqw`（保留两位小数）
  - clamp() 取桌面设计值（即 clamp 上限，对应 690px 卡宽下的渲染值）
  - 转换范围：内部组件的 top/left/right/bottom、width、padding、gap、margin、font-size、border-radius、`translateZ` 深度、装饰渐变半径（edge 280px、shine 530px、网格 52px）
  - letter-spacing 本来就是 em，随字号等比缩放，无需改动
- 删除 `@media (max-width: 640px)` 中所有卡片内部规则；删除整个 `@media (max-width: 480px)` 块（其规则全部是卡片内部适配，包括隐藏 year、去掉 br、改宽高比）
- 卡片宽高比恒为 `1.47 / 1`，不再有小屏固定高度

## 保持不变的部分

- 响应式断点只保留外层布局规则：`.experience-shell`、`.hero`、`.hero h1`、`.site-header`、`.edition`、`.hero__stage`、`.interaction-hint`、`.site-footer`
- `--edge-transition`（44px / 小屏 24px）与 `.card-perspective::before` 的 inset：指针交互的悬停缓冲区，属"整体"行为，且 `GlassCard.tsx` 的 JS 以 px 读取该值
- `perspective: 1450px` 保持 px：容器元素自身上的 cqw 会回退到 vw，不能转换；translateZ 已随卡宽缩放，视觉上保持比例
- JS 设置的倾斜/阴影变量（px）不变；box-shadow 模糊半径等环境装饰保持 px
- 1.5px 描边、1px 网格线等发丝线保持 px

## 验证

- `pnpm build` 通过
- 浏览器实际渲染，对比桌面（≥980px）与手机（375px）宽度：内部版式完全一致，仅整体缩放；3D 倾斜交互正常
