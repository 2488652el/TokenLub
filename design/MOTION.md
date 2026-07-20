# TokenLub Motion System

TokenLub 的动效采用 Fathom 式数据叙事：动画只用于解释信息层级、数据变化和操作反馈，不承担装饰任务。

## Motion tokens

| Token              | Duration | Usage                |
| ------------------ | -------: | -------------------- |
| `--motion-fast`    |    120ms | 按压、图标反馈       |
| `--motion-control` |    160ms | 颜色、边框、焦点     |
| `--motion-enter`   |    240ms | 页面、卡片、弹窗     |
| `--motion-data`    |    480ms | 数字、进度、状态变化 |
| `--motion-chart`   |    640ms | 图表绘制             |

- 位移范围为 2–6px；可操作卡片 hover 最多上移 2px。
- 列表错峰默认 36ms，最多 12 项，总等待不超过 180ms。
- 页面切换只动画右侧内容；侧栏保持稳定。
- 除加载中的 spinner 外，不使用无限循环动画。
- 不使用弹性过冲、强烈缩放、大幅滑入或随机动画。

## Semantic motion families

- **Page / section**：透明度 + 4px 上移，建立阅读顺序。
- **Metric**：数值从旧值过渡到新值，图标只做一次轻微强调。
- **Progress**：使用 `transform: scaleX()` 绘制，避免布局抖动。
- **Chart**：按图表语义绘制；系列过多时取消错峰。
- **Table / list**：只动画前 12 个可见项；筛选与分页保持容器位置稳定。
- **Interactive card**：hover 上移 2px并加深边框/阴影；非交互卡片不使用该反馈。
- **Status**：成功、错误、同步、刷新只在状态发生变化时强调一次。
- **Modal**：遮罩淡入，面板由 `translateY(4px) scale(.985)` 进入。

## Reduced motion

当 `prefers-reduced-motion: reduce` 命中时：

- CSS 动画和错峰立即完成。
- `AnimatedNumber` 直接显示最终值。
- `ProgressBar` 直接显示最终进度。
- Recharts 关闭路径绘制动画。
- 内容、焦点、ARIA 文本和操作能力必须保持完整。

## Performance guardrails

- 优先只动画 `transform` 与 `opacity`。
- 禁止对大批量节点使用 `transition-all`、宽度动画或阴影动画。
- 页面动画应在 1200ms 内全部结束。
- 表格、价格列表和 Key 卡片数量超过 12 时，其余项目直接显示。
- React effect、RAF、媒体查询监听器和定时器必须在卸载时清理。
