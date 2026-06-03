#!/usr/bin/env node
/**
 * 导入 Claude Code 和 Codex 历史会话到 Memorix
 * 通过 HTTP MCP API (localhost:3211) 写入
 * 用法: node import-history.mjs
 */

import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const MCP_URL = 'http://localhost:3211/mcp';

// 项目目录映射
const PROJECT_MAP = {
  'D--Kaction': 'D:/Kaction',
  'D--OrdKnow': 'D:/OrdKnow',
  'D--girlfriend': 'D:/girlfriend',
};

// ============ Memorix HTTP MCP Client ============
let requestId = 0;
const pending = new Map();

// 简单 HTTP MCP 客户端
async function mcpCall(method, params) {
  const id = ++requestId;
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function initMCP() {
  await mcpCall('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'history-import', version: '1.0' },
  });
  await mcpCall('notifications/initialized', {});
}

async function storeMemory(title, narrative, type, concepts, projectRoot) {
  // HTTP 模式需要通过 session 绑定项目
  // 先用 memorix CLI 的 remember 命令（更简单）
  const { execSync } = await import('child_process');
  const cmd = `cd "${projectRoot}" && memorix remember "${title.replace(/"/g, '\\"')}" --title "${title.replace(/"/g, '\\"')}" --type ${type}`;
  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    return true;
  } catch (e) {
    return false;
  }
}

// ============ Codex Import ============
async function importCodexSessions() {
  const codexDir = join(HOME, '.codex', 'sessions');
  console.log('\n=== Codex 历史导入 ===');

  let totalImported = 0;
  const years = await readdir(codexDir).catch(() => []);

  for (const year of years) {
    const months = await readdir(join(codexDir, year)).catch(() => []);
    for (const month of months) {
      const days = await readdir(join(codexDir, year, month)).catch(() => []);
      for (const day of days) {
        const files = await readdir(join(codexDir, year, month, day)).catch(() => []);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = join(codexDir, year, month, day, file);

          try {
            const content = await readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(Boolean);

            let sessionCwd = null;
            let sessionModel = null;
            const messages = [];

            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.type === 'session_meta') {
                  sessionCwd = entry.payload?.cwd;
                  sessionModel = entry.payload?.model_provider;
                }
                if (entry.type === 'response_item' && entry.payload?.role === 'user') {
                  let text = entry.payload?.content;
                  // Codex 消息是 [{type: "input_text", text: "..."}] 数组
                  if (Array.isArray(text)) {
                    text = text.map(c => c.text || '').join(' ');
                  }
                  if (typeof text === 'string' && text.length > 10) messages.push({ role: 'user', content: text.slice(0, 500) });
                }
                if (entry.type === 'response_item' && entry.payload?.type === 'message') {
                  const text = entry.payload?.content;
                  if (text && text.length > 20) messages.push({ role: 'assistant', content: text.slice(0, 500) });
                }
              } catch {}
            }

            if (!sessionCwd || messages.length === 0) continue;

            // 模糊匹配项目（支持 worktree 路径）
            const cwdLower = sessionCwd?.toLowerCase()?.replace(/\\/g, '/') || '';
            let projectRoot = null;
            if (cwdLower.includes('kaction')) projectRoot = 'D:/Kaction';
            else if (cwdLower.includes('ordknow')) projectRoot = 'D:/OrdKnow';
            else if (cwdLower.includes('girlfriend')) projectRoot = 'D:/girlfriend';

            if (!projectRoot) {
              console.log(`  跳过: ${basename(file)} (cwd=${sessionCwd?.slice(0, 50)} 无匹配项目)`);
              continue;
            }

            const userMsgs = messages.filter(m => m.role === 'user');
            if (userMsgs.length === 0) continue;

            const summary = userMsgs.slice(0, 3).map(m => m.content).join('\n').slice(0, 300);
            const date = `${year}-${month}-${day}`;
            const title = `[Codex ${date}] ${summary.slice(0, 60).replace(/\n/g, ' ')}`;
            const narrative = `Codex 会话 (${date}, model=${sessionModel || 'unknown'})\n\n${summary}`;

            console.log(`  导入: ${basename(file)} → ${projectRoot} (${userMsgs.length} 条消息)`);

            const ok = storeMemory(title, narrative, 'what-changed', ['codex-history', 'imported'], projectRoot);
            if (ok) totalImported++;
          } catch (e) {
            console.log(`  错误: ${basename(file)}: ${e.message}`);
          }
        }
      }
    }
  }

  return totalImported;
}

// ============ Claude Code Import ============
async function importClaudeSessions() {
  const claudeDir = join(HOME, '.claude', 'projects');
  console.log('\n=== Claude Code 历史导入 ===');

  let totalImported = 0;
  const projects = await readdir(claudeDir).catch(() => []);

  for (const projectDir of projects) {
    const projectRoot = PROJECT_MAP[projectDir];
    if (!projectRoot) continue;

    const projectPath = join(claudeDir, projectDir);
    const files = await readdir(projectPath).catch(() => []);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    console.log(`\n  项目: ${projectDir} → ${projectRoot} (${jsonlFiles.length} 个会话)`);

    for (const file of jsonlFiles) {
      try {
        const filePath = join(projectPath, file);
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        const userMsgs = [];

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && entry.content) {
              const text = entry.content;
              if (text.length > 10 && !text.startsWith('<') && !text.startsWith('/')) {
                userMsgs.push(text.slice(0, 500));
              }
            }
          } catch {}
        }

        if (userMsgs.length === 0) continue;

        const date = file.split('T')[0] || 'unknown';
        const summary = userMsgs.slice(0, 3).join('\n').slice(0, 300);
        const title = `[Claude ${date}] ${summary.slice(0, 60).replace(/\n/g, ' ')}`;
        const narrative = `Claude Code 会话 (${date})\n\n${summary}`;

        console.log(`    导入: ${file} (${userMsgs.length} 条用户消息)`);

        const ok = storeMemory(title, narrative, 'what-changed', ['claude-history', 'imported'], projectRoot);
        if (ok) totalImported++;
      } catch (e) {
        console.log(`    错误: ${file}: ${e.message}`);
      }
    }
  }

  return totalImported;
}

// ============ Main ============
async function main() {
  console.log('========================================');
  console.log('  Memorix 历史会话导入工具');
  console.log('========================================');

  // 检查 Memorix 后台
  try {
    const resp = await fetch('http://localhost:3211/health');
    const data = await resp.json();
    console.log(`  Memorix 后台: ${data.status}`);
  } catch {
    console.error('  错误: Memorix 后台未运行! 请先执行: memorix background start');
    process.exit(1);
  }

  const codexCount = await importCodexSessions();
  const claudeCount = await importClaudeSessions();

  console.log('\n========================================');
  console.log(`  导入完成!`);
  console.log(`  Codex: ${codexCount} 个会话`);
  console.log(`  Claude Code: ${claudeCount} 个会话`);
  console.log('========================================');
}

main().catch(console.error);
