需要两步：编译 whisper.cpp 和 下载模型文件。你的系统是 macOS，步骤如下：

第一步：编译 whisper.cpp 可执行文件
打开终端，运行：
# 克隆仓库
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
# 编译（macOS 自带 clang，直接 make 即可）
make
编译完成后，可执行文件在：

whisper.cpp/build/bin/whisper-cli
或老版本路径：

whisper.cpp/main
把这个路径填入 「whisper.cpp 可执行文件」 输入框。

第二步：下载 GGML 模型文件
whisper.cpp 仓库提供了下载脚本：

# 在 whisper.cpp 目录下运行
# base 模型，中英文识别效果不错，文件约 142MB
models/download-ggml-model.sh base

# 如果网络不好，也可以手动下载：
# https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

下载后模型文件在：
whisper.cpp/models/ggml-base.bin

把这个路径填入 「GGML 模型文件」 输入框。

模型大小参考
模型	文件大小	识别质量	速度
tiny	75 MB	一般	最快
base	142 MB	较好	快 ✅ 推荐
small	466 MB	好	中等
medium	1.5 GB	很好	较慢
验证配置
填好两个路径后，Settings 页面应该显示状态变为"可用"。

如果还是报错，可以在终端手动测试一下二进制是否可运行：

./build/bin/whisper-cli --help