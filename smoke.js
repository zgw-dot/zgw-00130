#!/usr/bin/env node

'use strict';

const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const SERVER_ROOT = path.join(ROOT, 'server');
const ACTUAL_SCRIPT = path.join(SERVER_ROOT, 'smoke_test.js');

function printRootHelp() {
  console.log(`
门诊候补号源系统 - 项目根目录统一验收入口
============================================

从项目根目录一条命令完成从零到通过的完整验收：
自动串起 安装 → seed → 拉起服务 → 健康检查 → API冒烟 → 跨重启二次验证。

用法:
  # 方式 A (推荐): 使用 npm script，记得参数前加 --
  npm run smoke-test -- [选项]
  npm run smoke-test:once -- [选项]

  # 方式 B: 直接用 node 调用（无需 -- 分隔符）
  node smoke.js [选项]
  node server/smoke_test.js [选项]

常用选项 (与 server/smoke_test.js 完全一致，原样透传):
  -h, --help                 显示此帮助
  --port <端口>              指定后端端口 (默认: 3001)
  --restart-port <端口>      第二轮跨重启验证端口 (默认: 3002)
  --data-dir <目录>          指定临时数据目录 (默认: 自动生成临时目录)
  --json <文件>              将摘要额外写入 JSON 文件
  --no-restart               只跑单次验证, 跳过跨重启二次验证
  --keep-data                测试结束后保留数据目录
  --skip-install             跳过 npm install (假设依赖已装)
  --skip-smoke               跳过 API 冒烟测试 (只验证安装+seed+启动)

示例:
  # 一次跑两轮（首次启动 + 跨重启换端口/数据目录）
  npm run smoke-test

  # 只跑一次，自定义端口
  npm run smoke-test:once -- --port 3099

  # 指定数据目录并保留，写 JSON 摘要
  node smoke.js --data-dir ./tmp_acceptance --keep-data --json result.json

失败代码 (exitCode):
  0  全部通过
  1  install_fail       依赖安装失败
  2  port_occupied      端口被占用
  3  seed_fail          seed 初始化失败
  4  server_not_up      后端未在超时时间内启动成功
  5  health_timeout     健康检查超时
  6  smoke_fail         API 冒烟测试失败
  7  restart_fail       跨重启二次验证失败
  99 unknown            未知异常

提示:
  - 日志写入 server/smoke_logs/smoke_*.log
  - 脚本禁止复用机器上已在跑的服务，端口占用会硬失败
  - 所有路径(数据目录、JSON输出)均相对项目根目录解析
`);
}

function resolveRelativePaths(rawArgv) {
  const resolved = [];
  const pathArgs = new Set(['--data-dir', '--json']);
  for (let i = 0; i < rawArgv.length; i++) {
    const a = rawArgv[i];
    if (pathArgs.has(a) && i + 1 < rawArgv.length) {
      const val = rawArgv[++i];
      const absVal = path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
      resolved.push(a, absVal);
    } else {
      resolved.push(a);
    }
  }
  return resolved;
}

const rawArgv = process.argv.slice(2);

if (rawArgv.includes('-h') || rawArgv.includes('--help')) {
  printRootHelp();
  process.exit(0);
}

const argv = resolveRelativePaths(rawArgv);

const node = process.execPath;
const child = spawn(node, [ACTUAL_SCRIPT, ...argv], {
  cwd: SERVER_ROOT,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error(`[根入口] 无法启动验收脚本: ${err.message}`);
  process.exit(99);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[根入口] 验收脚本被信号终止: ${signal}`);
    process.exit(99);
  }
  process.exit(code == null ? 99 : code);
});
