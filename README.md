# Replay Poker 胜率浮层（Chrome 本地扩展）

自动识别手牌 / 公共牌，用蒙特卡洛估算胜 / 平 / 败率，并在页面左上角显示浮层。

**硬边界：仅显示，绝不代打。** 不会点击 Fold / Call / Raise / Sit-in 等任何下注控件。


## 从 GitHub 下载 ZIP（推荐给非本机开发者）

推送到 `main` 或打 `v*` 标签后，Actions 会打出**已解压扩展的 ZIP**（内含 `manifest.json`、`content.js`、`README.md`，可选 `install-chrome.ps1`），便于「加载已解压」或发给别人。

1. **Releases（最省事）**  
   - 打开 [Releases](https://github.com/ceastld/replay-poker-odds/releases)  
   - `main` 每次推送会更新滚动预发布 **`latest`**；打标签（如 `v1.7.8`）会单独发正式 Release  
   - 下载 `replay-poker-odds-*.zip`，解压后得到文件夹 `replay-poker-odds-ext`
2. **Actions 产物**  
   - 打开 [Actions → Release extension](https://github.com/ceastld/replay-poker-odds/actions/workflows/release-extension.yml)  
   - 点进某次成功的 run → **Artifacts** → 下载同名 ZIP
3. 解压后按下面「方式 B：手动加载」选中该文件夹即可。

**关于 CRX / Chrome 网上应用店：** CI 只产出 ZIP，不包含也不生成扩展私钥。打包 `.crx` 或上架 Web Store 需要你自己的密钥 / 开发者账号，请勿把私钥写进仓库。

## 本地加载步骤

### 方式 A：一键脚本（推荐，Windows）

1. 把整个 `replay-poker-odds-ext` 文件夹放到本机任意位置（例如桌面）。
2. 右键 `install-chrome.ps1` → **使用 PowerShell 运行**（若被策略拦截，可先在 PowerShell 中执行：  
   `Set-ExecutionPolicy -Scope Process Bypass`，再 `.\install-chrome.ps1`）。
3. 脚本会：
   - 定位 Chrome；
   - 尽量打开开发者模式偏好；
   - 在本目录生成 `start-replay-chrome.bat`（带 `--load-extension` 启动）。
4. 双击 `start-replay-chrome.bat` 打开 Chrome，然后访问 Replay Poker 牌桌。
5. 若需先关掉已开着的 Chrome 再带扩展启动，可运行：  
   `.\install-chrome.ps1 -RestartChrome`（会提示并结束 chrome.exe）。

本助手也可在本机替你跑上述脚本，把扩展挂到 Chrome（仍需你确认是否重启浏览器）。

### 方式 B：手动加载

1. 打开 Chrome，地址栏输入 `chrome://extensions/`。
2. 右上角打开 **「开发者模式」**。
3. 点 **「加载已解压的扩展程序」**，选中本文件夹 `replay-poker-odds-ext`。
4. 打开 [Replay Poker](https://www.casino.org/replaypoker/) 或 [replaypoker.com](https://www.replaypoker.com/) 牌桌，左上角应出现胜率浮层。

## 使用说明

- 浮层显示：手牌、公共牌、对手数、胜 / 平 / 败率。
- **底池赔率提示**：能读到底池 P 与跟注额 B 时显示「跟注需 ≥ B/(P+B) 权益」并对比当前权益；读不到则隐藏。
- **「对手弃牌 -1」**：只减少浮层内的对手计数并重算，**不会**替你在牌桌上点 Fold。
- **「重算」**：用当前牌面再跑一轮蒙特卡洛。
- 识牌优先读站点 `console.info` 的 Hole / Community cards 日志；失败时回退到 DOM（`.Cards--mine` / `.Cards__communityCards`）。

## 文件

| 文件 | 说明 |
|------|------|
| `manifest.json` | MV3 清单（`world: MAIN`，以便 hook 页面 console） |
| `content.js` | 全部逻辑（仅显示） |
| `install-chrome.ps1` | Windows 本地挂载助手 |
| `start-replay-chrome.bat` | 由脚本生成：带 `--load-extension` 启动 Chrome |

## 注意

- 仅用于免费筹码练习辅助，不是自动打牌。
- `--load-extension` 每次新开的 Chrome 进程需带上该参数；长期使用也可在 `chrome://extensions` 里「加载已解压」一次并勾选允许。
- 修改 `content.js` 后，在扩展页点「重新加载」，再刷新牌桌页。
