# 小卖部查价

部署在飞牛 NAS 的一体化价格查询服务。员工可按商品名称、规格、Item ID、别名或包装条码查价；管理员可导入 Excel/CSV 或拍摄价格表，由服务端调用视觉模型识别并直接发布。

- 前端、价格表 API 和图片识别代理在同一个容器中运行。
- Sub2API 的地址、模型和 API Key 只保存在 NAS 的环境变量，不发送给浏览器。
- 已发布价格表只保存在挂载的 `data/products.json`，不会进入 Git 仓库或 Docker 镜像；容器重建或 NAS 重启不会丢失。
- 相同 Item ID 且同价、或相同商品名且同价会自动去重；不同价格会作为不同商品保留，避免 Item ID 录入错误阻塞发布。

## 飞牛 NAS 部署

1. 在 NAS 中创建部署目录，例如 `/vol1/1000/xiaomaibu-price-checker`，只需放入本仓库的 `compose.yaml` 和 `.env.example`。
2. 复制环境模板：`cp .env.example .env`。
3. 编辑 `.env`，填写 `SUB2API_API_KEY`；建议同时设置随机的 `ADMIN_TOKEN`。内网 Sub2API 地址、视觉模型和 `SUB2API_TIMEOUT_MS` 已有默认值；默认单张图片最多等待 3 分钟，可按实际模型速度修改。
4. 在飞牛的终端或 Compose 管理界面执行：

```bash
docker compose pull
docker compose up -d
```

5. 打开 `http://NAS_IP:3000`。可用下面的命令检查服务状态：

```bash
docker compose ps
curl http://127.0.0.1:3000/api/health
```

## 图片识别故障排查

查看服务日志：

```bash
docker compose logs --tail=200 -f xiaomaibu
```

页面提示无法连接 Sub2API 时，在 NAS 上执行下面的命令测试容器到 Sub2API 的连通性。它不会输出 API Key：

```bash
docker exec xiaomaibu-price-checker node --input-type=module -e 'const base = (process.env.SUB2API_BASE_URL || "").replace(/\/+$/, ""); const url = `${base}${/\/v1$/i.test(base) ? "" : "/v1"}/models`; try { const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SUB2API_API_KEY}` } }); console.log(JSON.stringify({ url, status: response.status })); } catch (error) { console.error(JSON.stringify({ url, name: error.name, message: error.message, code: error.cause?.code })); process.exit(1); }'
```

`status` 为 `200` 或 `401` 说明网络已通；`ECONNREFUSED` 表示端口或服务未开放，`ENOTFOUND` 表示地址/DNS 错误。日志中的 `timeoutMs` 是本次请求实际允许的最长时间；超时通常表示 NAS 与 Sub2API 不在可达网络、被防火墙拦截，或模型处理时间超过该值。

第一次启动会在 `data/products.json` 创建空价格表。通过页面导入表格或照片并点击“发布到 NAS”后，数据会直接写入这个持久化文件。备份时可复制 `data/products.json`，恢复后执行 `docker compose restart`。

GitHub `main` 每次推送都会自动构建 `latest` 镜像。升级 NAS 服务：

```bash
docker compose pull
docker compose up -d
```

GitHub 仓库与 GHCR 镜像均为公开访问，NAS 不需要 GitHub Token 或 `docker login`。

不要删除 `data/` 目录，否则会丢失管理员后续发布的价格表。

## Android App

每次推送到 GitHub `main` 后，`Build Android APK` 工作流会在 GitHub Runner 中执行前端测试、Capacitor 同步、Android lint 和 debug APK 构建。工作流成功后，在该次 Actions 运行的 Artifacts 下载 `xiaomaibu-android-<提交 SHA>`，解压并安装其中的 `app-debug.apk`。

首次打开 App 会要求连接 NAS：填写小卖部服务的根地址，例如 `http://NAS_IP:3000`，App 会调用 `/api/health` 验证后才保存。地址仅保存在该手机本地；App 不包含 NAS 地址、Sub2API 地址、模型 Key 或管理员口令。可从 App 右上角的“NAS 设置”重新测试或修改。

内网 HTTP 仅适合公司可信网络；通过公网访问时必须使用 HTTPS 和访问控制。当前产物是未进行正式发布签名的 debug APK，不可用于 Play 上架；不同 Actions 构建的 debug 签名可能不同，升级失败时先卸载旧版再安装新版，并重新填写 NAS 地址。

## 管理与识别

打开右上角“导入价格表”：

1. 使用“表格文件”导入 `.xlsx` 或 `.csv`，校对商品、价格、条码和上架状态。
2. 或切换到“照片识别”，拍摄或选择价格表照片，逐行检查模型生成的候选数据。
3. 设置了 `ADMIN_TOKEN` 时，在发布区填写同一口令；未设置时可留空。
4. 点击“发布到 NAS”，查询页会立即使用新价格表。“下载备份”可保存一份本地 JSON。

照片只会从浏览器上传至当前 NAS 服务，再由 NAS 服务发送给配置的 Sub2API。浏览器不会看到或保存模型 API Key。识别结果是候选数据，必须人工核对手写改价、反光和模糊小字。

## 本地开发

服务端和 Vite 开发服务器需要分别启动：

```bash
npm install
cp .env.example .env
npm run server
```

另开一个终端：

```bash
npm run dev
```

Vite 会将 `/api` 转发到本机 `3000` 服务。生产模式可执行：

```bash
npm run test
npm run build
npm start
```

## 安全建议

- `SUB2API_API_KEY` 和 `ADMIN_TOKEN` 必须只放在 NAS 的 `.env`，不要提交、截图或填入前端代码。
- 未设置 `ADMIN_TOKEN` 时，任何能访问网页的人都能发布价格表；仅适用于受控内网。
- 若通过公网、反向代理或微信小程序访问，应使用 HTTPS，并在外层增加访问控制。服务端代理已经解决浏览器到 Sub2API 的 CORS 限制，但不会替代公网安全策略。
