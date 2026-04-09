# DevX SKILL 通用设计范式

## SKILL 的本质

SKILL 是一个 **Markdown 文件（SKILL.md）**，本质上是一段"注入给 AI 的结构化提示词"，作用是让 AI 在特定场景下按你规定的流程行动。

存放路径：
- **全局 Skill**：`~/Library/Application Support/devx/claude-config/skills/<skill-name>/SKILL.md`
- **项目级 Skill**：`<project-path>/.claude/skills/<skill-name>/SKILL.md`

---

## 通用设计范式

```markdown
# <SKILL 名称>

## 目标（Goal）
一句话描述这个 Skill 要完成什么。

## 触发条件（Trigger）
用户说 /<skill-name> 时触发，可附带参数。

## 前置检查（Pre-flight Checks）
- 检查哪些文件/环境/工具存在
- 缺失时如何提示用户

## 执行步骤（Steps）
按序列出每一步，步骤要原子化、可验证：
1. 读取/分析 XXX 文件
2. 执行 XXX 操作
3. 校验结果

## 输出规范（Output Format）
- 返回给用户什么内容
- 格式：纯文本 / Markdown / 结构化列表

## 错误处理（Error Handling）
- 遇到 XX 错误时怎么处理
- 是否需要向用户询问确认

## 约束（Constraints）
- 不允许做什么
- 安全边界


## 项目开发场景的常见 Skill 类型
Skill	触发	核心职责
/commit	代码提交	读 diff → 生成规范 commit message → git commit
/review-pr	PR Review	读变更 → 按 checklist 检查 → 输出 review 意见
/new-feature	新功能开发	需求拆解 → 任务列表 → 逐步实现
/bug-fix	修 Bug	复现分析 → 定位根因 → 修复 → 验证
/refactor	重构	分析现有代码 → 制定改造方案 → 分步执行
/release	发版	检查 changelog → 更新版本号 → tag → 生成 release notes
/test-gen	生成测试	读源码 → 分析路径 → 生成测试用例
/doc-gen	生成文档	读接口/模块 → 生成 API 文档


## 完整示例：/commit Skill

# commit

## 目标
分析当前 Git 暂存区变更，生成符合 Conventional Commits 规范的提交信息并执行提交。

## 触发
用户执行 /commit，可附带可选的 scope 参数，如 /commit auth

## 执行步骤
1. 运行 `git status` 检查是否有暂存文件，没有则提示用户先 `git add`
2. 运行 `git diff --staged` 获取所有变更内容
3. 运行 `git log --oneline -5` 了解历史提交风格
4. 分析变更类型：feat / fix / refactor / chore / docs / test / style
5. 生成 commit message，格式：`<type>(<scope>): <subject>`
6. 展示给用户确认，询问是否执行
7. 执行 `git commit -m "..."`

## 输出格式
提交前展示完整 commit message 供用户确认。

## 约束
- 不得使用 --no-verify 跳过 hooks
- 不得提交包含密钥或 .env 文件
- commit message 主体不超过 72 字符


## 设计原则
单一职责 — 一个 Skill 只做一件事，边界清晰
步骤原子化 — 每步可独立验证，出错有明确位置
先读后写 — 操作前必须先读取相关文件，不猜测
显式约束 — 把"不能做什么"写进去，防止 AI 越权
用户确认点 — 破坏性操作（提交、删除、发版）前加确认
参数化设计 — 把可变部分抽成参数，提高复用性

## 目录结构
commit/
├── SKILL.md              ← 主入口
├── knowledge/
│   ├── conventions.md    ← 知识库（规范、规则、背景知识）
│   └── examples.md       ← few-shot 示例
└── scripts/
    ├── check-staged.sh   ← 前置检查脚本
    └── format-msg.sh     ← 格式化脚本

## 在 SKILL.md 中引用的写法
引用知识文件：

## 前置知识
执行前，读取 `knowledge/conventions.md` 了解本项目的提交规范，
严格按照其中定义的类型和格式生成 commit message。
引用脚本：

## 执行步骤
1. 执行脚本 `scripts/check-staged.sh`，检查暂存区是否为空
2. 若脚本退出码非 0，停止执行并提示用户
3. 继续后续步骤...