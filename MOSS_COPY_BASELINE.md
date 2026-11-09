# MOSS 节点原样副本基线

日期：2026-11-08。用户要求先复制一份，之后再修改。本次未改变生图实现。

## 来源与逐文件 SHA256

来源：权威开发目录的 `XiantuQwenImage21Director`，不是从测试端反向复制。

| 来源相对路径 | 本插件相对路径 | SHA256 |
| --- | --- | --- |
| moss_image_asset_workbench.py | moss_image_asset_workbench.py | 4c11ed2ea90769302258ef3412c03536867f3f67fd4788adcc6ecbb83635eab9 |
| web_20261004_upload_fix/xiantu_moss_image_asset_workbench.js | web/xiantu_moss_image_asset_workbench.js | 91ce65a1bfa64130275c2f063c6e7145ea79d0d0506cd08c621c1d059a7ee635 |
| web_20261004_upload_fix/xiantu_moss_image_asset_workbench.css | web/xiantu_moss_image_asset_workbench.css | aca53c326627afbd89f6cc40353156c777f7197b74afa1270241ded16f42e0ae |

三个文件按字节复制，未改类名、节点 ID、前端扩展名、状态键、样式、提示词、模板、分辨率、采样或生成行为。不调用原插件的 Python 模块；当前也不加载这些副本。

## 当前未启用，避免同名覆盖

- Python 原节点 ID 为 `XiantuMossImageAssetWorkbench`，显示名为 `MOSS图片资产工作台`。
- 前端扩展名为 `Xiantu.MossImageAssetWorkbench`，前端绑定同一原节点 ID。
- 新插件 `__init__.py` 仍为空映射，未导入副本，也未声明 `WEB_DIRECTORY`。
- 因此本次不会增加一个可在画布使用的新节点；这是待修改的原样源码副本，不是已完成的独立可运行迁移。
- 同时安装原插件时直接启用同名注册会冲突；后续启用前必须把副本的节点 ID、扩展标识及状态归属明确隔离，并测试。

## 已发现的依赖边界（待后续独立化）

Python 节点仅导入标准库 `hashlib`、`json` 和 ComfyUI 环境已有的 `torch`，使用输入 CLIP 的 tokenize / encode_from_tokens_scheduled；输出正负条件、宽高和占位 IMAGE。原节点并不内置采样器。

前端使用 ComfyUI 官方 `scripts/app.js`、`scripts/api.js` 和配套 CSS，无其他旧插件 JS 模块导入。除此之外，还请求以下旧插件公共接口，本次没有复制或启用这些接口：

- `local_image_import.py`：`/xiantu/video-editor/hardware`、`cleanup`，以及 `common-assets` 的查询、分类、内容、导入、更新、删除、应用接口。
- `local_image_import.py`：`/xiantu/image-workbench/rename-output`、`delete-outputs`。
- `pose.py`：`/xiantu/qwen21/pose/extract`。
- ComfyUI 自身接口：`/view`、`/history`、`/queue`、`/upload/image`、`/interrupt` 及队列提交等，仍属于宿主服务。

后续需逐项核实并建立本插件自有实现/接口归属，不应直接注册整份旧公共后端，也不能依赖“原插件刚好也装着”就声称已独立。现有前端包含部分其他模型的兼容标识；本次保持原样，未擅自清理或改变功能。

## 验证与边界

逐字节 SHA256 对照、Python/JS 语法和包入口未启用检查；不加载模型、不提交生成、不修改用户工作流。

原插件冻结；新插件已有入口和发布元数据冻结，仅 README 更新副本状态。没有覆盖测试端，没有上传 GitHub 或 Registry。备份位于 `E:\闲兔AI启动器统一备份\20261108-MOSS节点复制前`。
