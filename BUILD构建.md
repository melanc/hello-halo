根据仓库里的 package.json 和 中文 README，这个项目是 Node.js + Electron（用 electron-vite 打包源码），构建方式可以分成几类：
1. 日常开发（本地跑起来）

npm install
npm run prepare        # 拉取当前平台的二进制依赖
npm run dev

npm install 会触发 postinstall（含 patch-package、Electron 相关依赖安装、以及对 better-sqlite3 的 electron-rebuild），需要本机有合适的 Node.js 和构建环境（原生模块常见要求）。
若要为所有目标平台打安装包，文档建议先执行：
npm run prepare:all

2. 只编译（不打出安装包）
npm run build

对应脚本里是 electron-vite build，产物在配置的输出目录（主进程入口在 package.json 里写的是 ./out/main/index.mjs）。

3. 打桌面安装包（electron-builder）
在对应系统上执行，例如：
```
# macOS（当前机器架构，Apple Silicon 下为 arm64）
npm run build:mac
# macOS Intel x64
npm run build:mac-x64

# Windows
npm run build:win
# Windows x64（明确指定）
npm run build:win-x64
# Linux
npm run build:linux
```
这些脚本会先 bump-rc、再 npm run build、再跑 electron-builder。发布相关还有 release、release:mac 等。

4. 移动端（Capacitor）
先构建 Web 资源：npm run build:mobile
同步到原生工程：npm run cap:sync
Android/iOS 还有 cap:run:android、cap:run:ios、build:android:debug、release:android 等（Android 脚本里示例用了 ANDROID_HOME）。
简要对照：想改代码调试 → install + prepare + dev；想确认能编过 → build；想得到 .dmg/.exe/.AppImage → 用各平台的 build:*；想多端打包 → 先 prepare:all。更细的贡献流程可见仓库根目录的 CONTRIBUTING.md。

-------