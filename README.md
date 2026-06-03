# Memorix 多项目记忆共享配置

跨 Agent（Claude Code + Codex + 飞书）的多项目记忆共享系统配置和工具。

## 架构

```
Claude Code → HTTP MCP (localhost:3211) ─┐
                                         ├──→ ~/.memorix/data/memorix.db
Codex      → stdio MCP (memorix serve) ──┘
```

- **Memorix**: 统一记忆层，通过 Git 根目录自动识别项目身份
- **cc-connect**: 飞书桥接，单 Bot + `/switch` 切换项目
- 项目隔离：默认搜索限定当前项目，跨项目用 `--scope global`

## 快速开始

```bash
# 1. 安装依赖
npm install -g memorix cc-connect

# 2. 初始化 Memorix
memorix init --global

# 3. 启动 Memorix 后台
memorix background start

# 4. 配置 Claude Code MCP
claude mcp add --scope user --transport http memorix http://localhost:3211/mcp

# 5. 配置 Codex MCP（~/.codex/config.toml）
# [mcp_servers.memorix]
# command = "memorix"
# args = ["serve"]
# startup_timeout_sec = 30

# 6. 配置 cc-connect（~/.cc-connect/config.toml）
# 参考 config.example.toml

# 7. 启动 cc-connect
cc-connect
```

## 历史导入

```bash
node scripts/import-history.mjs
```

导入 Claude Code 和 Codex 的历史会话到 Memorix。

## 新增项目

只需：
1. `git init`（确保有 Git 仓库）
2. Claude Code / Codex 自动识别
3. 飞书需在 `~/.cc-connect/config.toml` 追加配置

## 依赖

- [Memorix](https://github.com/AVIDS2/memorix) - 跨 IDE 记忆层
- [cc-connect](https://github.com/chenhg5/cc-connect) - 飞书桥接
