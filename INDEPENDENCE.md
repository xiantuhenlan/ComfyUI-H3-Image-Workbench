# 独立运行边界与本次变更

日期：2026-11-08。

## 独立的实现与标识

- 入口导入本包的 moss_image_asset_workbench.py 和 services.py；条件与文本生成模块仅使用 ComfyUI 核心 PH3ImageConditioning / TextGenerateV2，不导入旧插件、不扫描或调用其他插件的节点映射。
- 节点 ID：ComfyUIH3ImageWorkbench；前端扩展：ComfyUI.H3ImageWorkbench。
- 插件英文名称与目录一致；启动器追加（闲兔H3生图工作台）；按用户最新指令，画布节点及工作台窗口均显示闲兔H3生图工作台，英文仓库与文件夹不改。
- 前端样式和实例属性使用 h3iaw，序列化属性使用 h3ImageWorkbenchState；不读旧节点的状态属性。
- 当前外部仅 clip、vae、prompt_upsampler 三个模型口及打开工作台按钮；图片、提示词和尺寸均在工作台内。project_name/workbench_state 为隐藏序列化字段。
- 图片从当前任务 referenceImages 按顺序经 ComfyUI 核心 LoadImage 加载，按 image_1 到 image_9 交给 PH3ImageConditioning。提示词取当前任务 prompt，尺寸按左侧所选 width/height，不擅自改成 0/0，不增加额外图片、负面编码或颜色处理。
- 优化提示词导航旁有用户要求的开关，默认开启、按任务保存。开启时按参考工作流参数 1536/off/thinking=true/default_template=true/MTP=auto/system_prompt为空调用官方 Generate Text；关闭时原提示词直达条件节点，不使用旧优化结果。没有自动尺寸、折叠参数或 thinking 面板。
- prompt_upsampler 使用 ComfyUI 核心惰性输入。关闭优化时不请求其上游加载节点，不改该节点 mode 或连线，不执行卸载；开启后重新请求。若该模型还被其他执行分支使用，其他分支仍可请求它，不能宣称全局禁用该模型。已驻留内存也不强制卸载。
- 按用户要求，右侧模板分类、搜索与自由创作区不再显示，提示词导航和编辑框占满右侧可用高度。只改变新工作台侧栏布局，不影响资产库或其他插件。
- 左侧资产库按钮在文生图、图生图两种模式都保持面板底部；图生图参考图列表单独滚动，不把资产库按钮挤走。
- 用户明确要求角色多视图另做插件。H3 内仅有可选桥接按钮，不包含多视图实现、不导入独立插件 Python、不把独立插件加入依赖。接口为 ComfyUICharacterMultiview v1，按发起任务的 contextId 和对象归属写回 prompt/characterMultiview；未安装或取消不改任务，普通生图不受影响。
- 文生图/图生图两个模式按任务保存。文生图隐藏上传区，不向优化器和条件节点提交已存参考图；图生图显示上传区并提交当前任务参考图。切换只改变使用方式，不删除已上传图片。图生图无图时提示上传，不静默生成文生图。
- 旧实例恢复时清理外露控件与三个旧输出，保留模型连线和合法 positive 连线，不把旧负面 CONDITIONING 当 Latent。按命名字段或 JSON 结构恢复分镜内容，避免旧控件数组错位导致 NaN 或把工程名当提示词。

## 自有接口与目录

services.py 中包含本插件自己的资产 CRUD、元数据锁、图片改名/删除、硬件监控和清理实现；不是对旧接口做代理。仅注册 `/xiantu/h3-image-workbench/` 前缀下的 11 项 HTTP 方法/路径组合。

默认资产目录：ComfyUI 用户目录下的 `comfyui-h3-image-workbench/assets`。如需显式配置，仅使用本插件的 COMFYUI_H3_IMAGE_ASSET_ROOT，不读取旧的 XIANTU_ASSET_LIBRARY_ROOT、不向祖先目录查找闲兔资产库。

资产应用和上传素材进入 `ComfyUI/input/h3_image_workbench`。不会自动搬走或修改原资产库内容。

CPU/内存通过 Python 包 psutil；NVIDIA 显存/温度通过 nvidia-smi。硬件查询失败会显示不可用，不编造读数；不新增其他显卡的监控实现。

清理接口在用户明确勾选时使用 ComfyUI/Torch 的清理 API。GPU、CPU、模型缓存属于同一个 ComfyUI 进程，不是插件私有资源；独立接口不意味着清理操作不会影响进程内其他任务。

## 不属于其他插件依赖的宿主接口

仍使用 ComfyUI 自带 app.js/api.js、PH3ImageConditioning、TextGenerateV2、CLIP、Torch、aiohttp、上传/查看/历史/队列/中断接口。需要安装包含这两个核心节点的内核，不回退到旧 MOSS 实现。工作流的加载器、采样器和保存节点仍由工作流提供，本插件不捆绑模型或替代这些节点。

## 历史隐藏分支的限制

复制的 JS 包含原综合界面遗留的 Qwen/Krea/姿势编辑分支，正常界面不启用这些分支。界面模型显示 H3 模型；为保留已有界面模板与保存结构，内部历史 modelProfile 标记尚保留 MOSS，但条件执行不读取此标记、不调用 MOSS 编码器。

本次没有引入 controlnet_aux 或 DWPose 插件依赖，没有声称提供独立骨骼推理实现。隐藏分支里的 pose/extract 地址已隔离为本插件前缀，但没有注册此未实现的接口，不会回退调用旧插件。未来若启用这些隐藏功能，必须另行实现并验收，不能以本次测试声称支持。

## 验证范围

初次独立化的 21 项检查属于旧 MOSS 后端阶段的历史记录。本次条件改造另以实际安装的 ComfyUI 核心实现、替身编码器和 CPU 张量比较：输入定义、文生图/编辑/多图顺序、自动/自定尺寸、VAE与文本输入、输出张量、扩写参数和结果归属；不是以旧 build AST 测试充当当前条件验收。

负面、演示和官方说明从提示词界面隐藏，仅保留提示词与 Generate Text；旧状态的 negative 字段不参与条件输出。助手悬浮条只在新工作台打开时通过新插件自有 CSS 隐藏，不修改助手代码、不关闭本插件自有硬件监控。

不代表已经完成真实模型生成或完整浏览器交互验收。本次不覆盖测试端、不重启、不发布。
