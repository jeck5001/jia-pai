# 进度

- 已核对：目录无工程和 Git 仓库，有 8 张受保护价格单照片；Node v24.3.0，npm 11.18.0。
- 目标：交付可部署到飞牛 NAS 的一体化价格查询服务，查询端通过同源 API 读取已发布的 `products.json`。
- 顺序：先定义价格数据契约和查询，再完成本地导入/校对/导出，最后接入服务端持久化和视觉模型代理。
- 已知限制：照片 25、26、27、29、30、31、32 未标明表格日期；同一商品可能有不同报价，购买前须由小卖部管理员确认现行价格。
- 视觉方向：纸张白与墨绿的紧凑工具界面，价格信息优先，移动端单手查询。
- 已完成：静态 PWA 查询、扫码入口、本地 Excel/CSV 导入校对、JSON 导出、中文运维说明，以及从 8 张照片整理并去重后的 175 条来源报价。相同 Item ID 且同价、或相同商品名且同价的记录只保留一条；不同价格仍会分别显示来源。
- 已完成：新增 NAS 一体化 Node 服务，托管前端、持久化 `data/products.json`、提供管理员口令保护的目录发布 API，并由服务端调用 Sub2API 识别照片。前端不再接触模型地址或 API Key，导入和照片校对完成后可直接发布到 NAS。
- 已完成：新增 Dockerfile、Compose、`.env.example` 和飞牛 NAS 部署说明；容器通过挂载 `./data:/app/data` 保留价格表。

## Android App 进度

- 2026-07-28 任务 0 已复核：`npm run test` 为 5 个文件、17 项测试全绿；`npm run build` 成功并转换 1857 个模块。
- 目标：用 Capacitor 打包现有 React 界面为 Android App，并由 GitHub Actions 云端生成可侧载 debug APK。
- 顺序：先实现仅原生端需要的 NAS 地址配置与 API 路径，再接入 Android 工程，最后补 CI、APK 校验和文档。
- 最大风险：Android WebView 访问内网 HTTP 和跨域 API；使用 CapacitorHttp 原生请求补丁及 Android 的内网 HTTP 配置处理，网页端继续同源请求。
- 已完成：Capacitor 8.4.2 Android 工程、`com.jeck5001.jiapai` 应用 ID、联网/相机权限、原生 NAS 首次连接页和可重开设置入口。
- 已完成：新增地址解析单测；网页端固定保留相对 `/api`，原生端保存并验证 NAS 根地址后才使用绝对 API 地址。
- 已完成：新增 GitHub Android 工作流，云端执行测试、Web 构建、Capacitor 同步、`assembleDebug lintDebug`、APK 身份和权限校验，上传 30 天 APK Artifact。
- 反向验证：临时将新增地址测试改为允许非法地址后，`npm run test -- src/lib/app-config.test.ts` 如预期为 1 个文件失败、4 项失败，覆盖 `ftp://...` 和带 `?debug=1` 的地址；还原断言后同一命令为 1 个文件、7 项全绿。
- CI 第 1 次构建：`assembleDebug` 已成功，`lintDebug` 因 CAMERA 权限缺少非必需硬件声明失败；已补 `android.hardware.camera required=false`，不使用 lint baseline 或关闭 lint 绕过。
