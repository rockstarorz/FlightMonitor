# FlightMonitor v0.1

FlightMonitor 是一个在本机运行的三维飞行航迹回放项目。它用 GPSTest 记录的 GNSS 数据展示实测轨迹、定位空档、海拔、地速和估算的飞机滚转。时间轴、飞行剖面和地图同步。

## 镜头操作

先点击地图。WASD 沿当地地表平移，前后方向跟随镜头的水平朝向，镜头高度和俯仰独立。Q/E 绕当地地表法线向左或向右转头，F 抬头，R 低头，空格/Shift 升降。鼠标滚轮拉近或拉远，按住滚轮拖动可旋转和倾斜。

## 本地运行

本仓库包含程序源码、通用飞机模型和产品文档。运行完整回放需要在本机放置这些文件：

- `dist/vendor/Cesium/` 下的 CesiumJS 1.147.0 浏览器发行文件，可从 [CesiumJS 发行页](https://github.com/CesiumGS/cesium/releases/tag/1.147)或同版本 npm 包的 `Build/Cesium/` 获取。
- `dist/data/flight.json` 是回放数据。`prepare.py` 针对 v0.1 的原始 GPSTest 样本和时间范围，输出结构见脚本。应用可用此结构加载处理后的数据。
- `dist/geo/` 中的卫星影像和地形二进制文件，名称和范围见 [地图配置](dist/geo/layers.json)，来源与署名见 [地图数据来源](dist/geo/sources.html)。已有的本地分享包可以提供这套运行素材。

用 Python 3.8 或更新版本运行 `python3 launch.py`。Windows 可以双击 `Start-FlightMonitor.cmd`，macOS 可以双击 `Start-FlightMonitor.command`。页面会通过本机 HTTP 地址打开。

[产品需求文档](PRD.md) · [需求表](REQUIREMENTS.md)
