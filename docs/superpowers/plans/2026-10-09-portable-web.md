# CloudTune Windows 本地网页版便携包实施计划

**目标：** Windows x64 用户解压后双击 BAT，无需安装 Node、npm、yt-dlp 或 FFmpeg；浏览器使用现有功能。

**架构：** 保留 Node HTTP 服务与现有网页；新增本地启动器，使用附带 Node 和转换工具。启动器等待服务就绪后打开浏览器，重复启动复用现有实例。每位 Windows 用户的数据使用 LOCALAPPDATA/CloudTune/data，先复制旧 data，保留原文件。分发包以文件白名单生成，排除真实账号、音乐、运行日志、测试与下载缓存。

**技术：** Node 22 LTS、Windows BAT、Node 文件锁及 loopback HTTP、Windows DPAPI、SHA-256 校验、ZIP。

## 实施顺序
- [x] 写并运行启动、重复启动、停止、数据迁移、分发排除测试。
- [x] 新增 data-location.js 与 launcher.js；补充健康接口、受本机控制密钥保护的停止接口和启动失败处理。
- [x] 改启动 BAT 优先使用 bundled runtime，增加中文版启动/停止入口。
- [x] 下载并校验官方运行环境与转换工具；固定第三方版本，保留许可与来源信息。
- [x] 新增构建便携包脚本与简明用户说明；白名单复制到发布目录并压缩。
- [x] 完整回归、仅使用包内运行环境和工具的模拟新用户启动验证、归档隐私扫描与哈希核验。
- [x] 交付 ZIP 路径，说明初次迁移步骤与测试范围。没有第二台干净电脑时明确验证限制。

## 验收结果（2026-10-09）

- 完整回归 55 项：54 通过，0 失败，1 项 Unix 下载器模拟测试在 Windows 跳过；Windows 子进程树关闭有独立通过的测试。
- 最终 ZIP 解压到中文及空格路径，用仅包含 Windows 系统目录的 PATH 启动 BAT；实际加载包内 Node 22.23.3、yt-dlp 2026.08.19、FFmpeg 9.0.2。
- SDK 实际加载、真实 FFmpeg 生成 MP3、本地导入和范围试听、保存封面、重复启动、重启保存、双模拟用户隔离和干净停止均通过。
- ZIP 4951 项，根目录仅 node_modules、public、runtime、third-party、tools 和白名单程序文件；不含私人 data、会话、音乐、测试或构建缓存。
- ZIP：release/CloudTune-0.6-Windows-x64.zip，155164336 字节。
- SHA-256：3135bd555a08586cd11ba683c1ee63786dbd38ac6963872065825d1f34cd6828。
- 未在第二台实体电脑测试；未用真实账号重新扫码、上传或改写网易云文件。现有音乐和会话原文件保持原样，用户下次使用新的启动入口时复制迁移。
