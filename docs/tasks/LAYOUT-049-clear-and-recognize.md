# LAYOUT-049 参考原图一键清空并识别

状态：已实现并通过模拟 UI 回归

日期：2026-11-27
关联：LAYOUT-043 参考原图与混排布局

## 目标与验收

已应用排版（画布有家具）后打开「参考原图摆位」点击「识别原图家具」会被「请清除当前画布上的家具」拦截，而参考面板打开期间画布只渲染参考层、普通家具不可选中删除，用户只能返回组合布局手动清空后再回来识别，操作繁琐。目标：拦截提示旁提供一键「清空画布家具并继续识别」，用户显式确认后在面板内完成清空并自动发起识别，不离开当前面板；不违反「重新识别不静默清空用户编辑」原则（有显式确认弹窗）。

## 实现

- `LayoutReferencePanel.vue` 新增 `gateClearAndRecognize` 标记：仅 `recognize()` 的空画布拦截置为 true，`applyCurrent()` 的兜底拦截置为 false（识别结果面向空画布，应用拦截不提供一键清空，避免用旧结果覆盖新排版）。
- 新增 `clearAndRecognize()`：`window.confirm` 显式确认后调用既有 `store.clearFurniture(zoneId)`（同步扣减关联购物车行），清空 gate 状态后立即重新执行 `recognize()`。
- 模板在 gate 提示下渲染 `data-testid="reference-clear-and-recognize"` 按钮，识别进行中禁用。

## 验证

- `pnpm build`：通过（既有警告不变）。
- `node scripts/e2e-preview-drag.mjs`：通过，全部 API 模拟。原「返回组合布局→清空排版→重开面板→再点识别」迂回路径替换为一键清空按钮场景：拦截后点击按钮、接受确认弹窗、画布家具清空、识别自动发起且按钮禁用，后续跨标签页任务保留等既有断言不受影响。运行需指定 `PLAYWRIGHT_EXECUTABLE_PATH` 指向本机已有 chromium_headless_shell-1254（本地 playwright 1.64.0 默认期望 1248，未安装）。
- 未执行真实服务验收，未部署；未提交。

## 2026-11-27 确认方式改为面板内两步确认

初版用浏览器原生 `window.confirm`，样式与项目不一致且位置固定在浏览器顶部。改为面板内两步确认卡片（`role="alertdialog"`）：首击「清空画布家具并继续识别」展开确认卡片，说明影响范围并提示可撤销，「确认清空并继续」执行清空 + 识别，「取消」回到首击状态。新增 `confirmingClear` 状态，`recognize()` 重置 gate 时一并复位；`data-testid="reference-clear-confirm-ok"` 供 e2e 使用。验证：`pnpm build` 与 `node scripts/e2e-preview-drag.mjs` 复跑通过（条件同上）。
