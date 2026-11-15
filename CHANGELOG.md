# Changelog

## 0.1.1 — 2026-11-15

- 新增独立的 H3-IMAGE 页面，接入官方文生图和图生图条件、4 至 20 MP 输出预设及可选提示词优化。P-H3 保留独立页面。
- 文生图和图生图分别保存提示词。支持 `@` 选取参考图、工作台内选择 LoRA、画布功能标记和原图缩放预览。
- 改善分镜进度与耗时显示，关闭工作台后重开可查看后台生成状态，并继续使用停止按钮。
- 新增保存文件名设置和画布「文件名」输出，默认保存到 `output/H3生图`。
- 角色多视图模板明确背景、留白和角色体型的提示词约束。

## 0.1.0 — 2026-11-09

- Initial independent H3 image workbench, per-shot prompt/reference handling and core PH3ImageConditioning outputs.
- Optional core prompt optimization, default off; existing explicit choices retained. Double-click selects all prompt text.
- Independent asset library and hardware monitoring. Optional integration with Character Multiview Workbench.
- Experimental multiview white-model editing, with unresolved real-generation adherence limitations for headless/side/appearance transfer; no guarantee of correct generated layouts.
