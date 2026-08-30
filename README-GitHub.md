# Asset Allocator — GitHub Pages / iPhone PWA

这是已经配置好的离线 PWA 包。不要把 ZIP 文件直接上传 GitHub Pages；请先解压，然后把本文件夹里的文件和 `icons` 文件夹上传到仓库根目录。

## GitHub Pages 部署

1. GitHub 新建公开仓库，例如 `asset-allocator`。
2. 将以下内容上传到仓库根目录：
   - `index.html`
   - `manifest.json`
   - `service-worker.js`
   - `.nojekyll`
   - `icons/` 整个文件夹
3. 进入仓库 `Settings` → `Pages`。
4. `Source` 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/(root)`，保存。
6. 等待 GitHub Pages 给出 HTTPS 地址，例如：
   `https://你的用户名.github.io/asset-allocator/`
7. 第一次必须联网访问一次，让 Service Worker 完成离线缓存。

## iPhone 安装

1. 用 Safari 打开 GitHub Pages 地址。
2. 点击 Safari 的“分享”。
3. 选择“添加到主屏幕”。
4. 如果出现“作为 Web App 打开”，保持开启。
5. 名称保持为 `Asset Allocator`，点击“添加”。

## 离线测试

1. 安装后，在联网状态打开 Asset Allocator 一次，并等页面完整载入。
2. 关闭 App。
3. 开启飞行模式并确保 Wi‑Fi 也关闭。
4. 从主屏幕重新打开 Asset Allocator。

计算器、ETF 选择、比例、排序、本地保存等本地功能应继续可用。实时行情或未来新增的联网数据功能在断网时无法刷新。

## 更新网页

以后更新 `index.html` 后直接提交到同一 GitHub 仓库即可。联网打开时，PWA 会优先尝试获取最新版页面，并更新离线缓存。

如果修改了图标、manifest 或 Service Worker 的核心缓存文件，建议同时把 `service-worker.js` 中的 `CACHE_NAME` 从例如 `asset-allocator-pwa-v1` 改成 `asset-allocator-pwa-v2`，确保旧缓存被清理。
