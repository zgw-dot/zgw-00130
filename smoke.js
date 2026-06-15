#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const SERVER_ROOT = path.join(ROOT, 'server');
const ACTUAL_SCRIPT = path.join(SERVER_ROOT, 'smoke_test.js');
const RECORDS_DIR = path.join(SERVER_ROOT, 'smoke_records');

const FAIL_CODE_MAP = {
  1: 'install_fail', 2: 'port_occupied', 3: 'seed_fail',
  4: 'server_not_up', 5: 'health_timeout', 6: 'smoke_fail',
  7: 'restart_fail', 8: 'invalid_data_dir', 99: 'unknown',
};

function failCodeToString(code) {
  return FAIL_CODE_MAP[code] || 'unknown';
}

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
  --json <文件>              将摘要额外写入 JSON 文件 (父目录不存在会自动创建)
  --no-restart               只跑单次验证, 跳过跨重启二次验证
  --keep-data                测试结束后保留数据目录
  --skip-install             跳过 npm install (假设依赖已装)
  --skip-smoke               跳过 API 冒烟测试 (只验证安装+seed+启动)
  --history <N>              查看最近 N 次运行记录

最终摘要（对账口径，所有成功/失败路径统一输出）:
  无论本轮结果是成功、早期参数错误、端口冲突还是运行中崩溃，控制台结尾都会
  打印统一格式的「最终摘要（对账口径）」块，包含以下关键字段:
    - 本轮结果 (finalResult) + 命令 (command) + 参数 (argv)
    - 端口: port + restart-port
    - 数据目录: data-dirs（列出本轮使用的所有目录）
    - 失败分类: failCode + failReason（非失败不出现）
    - 各轮次明细: 每轮的端口/PID/数据目录/冒烟统计/时长/结果
    - 对账路径三件套: logPath / recordPath / jsonPath（若指定 --json）

运行记录:
  每次运行（无论成功或失败），都会自动在 server/smoke_records/ 目录下生成一条
  JSON 记录文件 (record_<timestamp>.json)，包含:
    - 命令参数 (command, argv)
    - 安装状态 (install: executed/skipped/ok)
    - seed 目录与结果
    - 服务进程 PID、端口
    - 健康检查结果
    - 冒烟测试结果 (passed/failed/errors)
    - 各轮次详情 (第一轮、第二轮)
    - 失败分类 (failCode, failReason)
    - 日志路径 (logPath)、运行记录路径 (recordPath)
    - 数据目录列表 (dataDirs)、摘要输出路径 (jsonPath)
  使用 --history <N> 可快速查看最近 N 条记录。

示例:
  # 一次跑两轮（首次启动 + 跨重启换端口/数据目录）
  npm run smoke-test

  # 只跑一次，自定义端口
  npm run smoke-test:once -- --port 3099

  # 指定数据目录并保留，写 JSON 摘要到新目录（父目录自动建）
  node smoke.js --data-dir ./tmp_acceptance --keep-data --json ./results/r1.json

  # 查看最近 5 次运行记录
  npm run smoke-test -- --history 5
  node smoke.js --history 5

失败代码 (exitCode):
  0  全部通过
  1  install_fail       依赖安装失败
  2  port_occupied      端口被占用 (检测到机器已有服务监听)
  3  seed_fail          seed 初始化失败
  4  server_not_up      后端未在超时时间内启动成功
  5  health_timeout     健康检查超时
  6  smoke_fail         API 冒烟测试失败
  7  restart_fail       跨重启二次验证失败
  8  invalid_data_dir   data-dir 参数非法 (指向文件而非目录)
  99 unknown            未知异常

提示:
  - 日志写入 server/smoke_logs/smoke_*.log
  - 运行记录写入 server/smoke_records/record_*.json
  - 脚本禁止复用机器上已在跑的服务，端口占用会硬失败
  - 所有路径(数据目录、JSON输出)均相对项目根目录解析
`);
}

function showHistory(n) {
  if (isNaN(n) || n <= 0) {
    console.error('--history 需要正整数参数');
    process.exit(99);
  }
  if (!fs.existsSync(RECORDS_DIR)) {
    console.log('暂无运行记录');
    process.exit(0);
  }
  const files = fs.readdirSync(RECORDS_DIR)
    .filter(f => f.startsWith('record_') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.log('暂无运行记录');
    process.exit(0);
  }
  const selected = files.slice(0, n);
  console.log(`\n最近 ${n} 次运行记录 (共 ${files.length} 条):\n`);
  for (const f of selected) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RECORDS_DIR, f), 'utf8'));
      const ts = data.timestampISO || data.id.replace('record_', '');
      const resultStr = data.finalResult === 'pass' || data.finalResult === 'pass_round1_only'
        ? '✅ PASS'
        : `❌ FAIL (${failCodeToString(data.failCode)})`;
      const cmd = data.command || '';
      const port = data.rounds && data.rounds[0] ? data.rounds[0].port : (data.port || '-');
      const dur = data.durationMs ? `${(data.durationMs / 1000).toFixed(1)}s` : 'n/a';
      const installStr = data.install
        ? (data.install.executed ? '安装执行' : (data.install.skipped ? '安装跳过' : '安装未到'))
        : '-';
      const dataDirsStr = data.dataDirs ? data.dataDirs.join(', ') : '-';
      console.log(`  ${ts}  ${resultStr}  端口=${port}  时长=${dur}  安装=${installStr}`);
      console.log(`    命令: ${cmd}`);
      console.log(`    参数 argv: ${JSON.stringify(data.argv || [])}`);
      console.log(`    数据目录: ${dataDirsStr}`);
      if (data.rounds) {
        for (const r of data.rounds) {
          const ri = r.ok ? '✅' : '❌';
          const smokeStr = r.smoke ? `${r.smoke.passed}/${r.smoke.passed + r.smoke.failed}` : (r.smoke && r.smoke.skipped ? '跳过' : '-');
          const rdur = r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s`
                    : (r.duration != null ? `${(r.duration / 1000).toFixed(1)}s` : 'n/a');
          console.log(`    ${ri} ${r.label} PID=${r.pid || '-'} 端口=${r.port || '-'} 数据=${r.dataDir || '-'} 烟雾=${smokeStr} 时长=${rdur} 结果=${r.ok ? 'PASS' : 'FAIL:' + failCodeToString(r.failCode)}`);
        }
      }
      if (data.failReason) {
        console.log(`    失败原因: ${data.failReason}`);
      }
      const pt = data.paramsTrace;
      if (pt) {
        console.log(`    参数追溯: port=${pt.port} restart-port=${pt.restartPort} skipInstall=${!!pt.skipInstall} noRestart=${!!pt.noRestart}`);
        if (pt.dataDir && pt.dataDir.length > 0) {
          console.log(`    数据目录: ${pt.dataDir.join(', ')}`);
        }
        if (pt.roundResults && pt.roundResults.length > 0) {
          for (const rr of pt.roundResults) {
            const ricon = rr.ok ? '✅' : '❌';
            const rf = rr.failCode ? ` (${failCodeToString(rr.failCode)})` : '';
            console.log(`      ${ricon} ${rr.label} 端口=${rr.port} 数据=${rr.dataDir || '-'} 结果=${rr.ok ? 'PASS' : 'FAIL' + rf}`);
          }
        }
      }
      const art = data.artifacts;
      if (art) {
        const fmt = (a) => {
          if (!a) return '(无)';
          if (a.exists) return `✅ ${a.actualPath} (${a.sizeBytes}B)`;
          return `❌ ${a.reason || '未创建'} (期望: ${a.expectedPath || '-'})`;
        };
        console.log(`    产物-日志: ${art.log ? fmt(art.log) : '-'}`);
        console.log(`    产物-记录: ${art.record ? fmt(art.record) : '-'}`);
        if (art.json) console.log(`    产物-JSON: ${fmt(art.json)}`);
      } else {
        console.log(`    日志: ${data.logPath || '-'}`);
        console.log(`    记录: ${data.recordPath || '-'}`);
        if (data.jsonPath) console.log(`    JSON: ${data.jsonPath}`);
      }
      console.log('');
    } catch (_) {
      console.log(`  [无法读取: ${f}]`);
    }
  }
  process.exit(0);
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

for (let i = 0; i < rawArgv.length; i++) {
  if (rawArgv[i] === '--history') {
    const n = parseInt(rawArgv[i + 1], 10);
    showHistory(n);
    break;
  }
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
