const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}

function grepFile(filePath, pattern) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (pattern.test(line)) hits.push({ line: i + 1, text: line });
  });
  return hits;
}

(async () => {
  console.log('=== 回归验证：安装说明与实际依赖对齐 ===\n');

  console.log('1. README 不含 better-sqlite3 / 原生编译 / build-from-source 旧说法');
  const readme = path.join(ROOT, 'README.md');
  const badPatterns = [
    /better-sqlite3/i,
    /build-from-source/i,
    /VS Build Tools/i,
    /(?<!无需)原生编译(?!环境)/,
  ];
  for (const pat of badPatterns) {
    const hits = grepFile(readme, pat);
    assert(hits.length === 0, `README 无 ${pat.source} 残留 (找到 ${hits.length} 处)`);
  }

  console.log('\n2. README 含 sql.js 正确说明');
  const sqlJsHits = grepFile(readme, /sql\.js/);
  assert(sqlJsHits.length >= 1, `README 提及 sql.js (${sqlJsHits.length} 处)`);

  console.log('\n3. server/package.json 依赖是 sql.js 而非 better-sqlite3');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8'));
  assert(!!pkg.dependencies['sql.js'], 'server 依赖包含 sql.js');
  assert(!pkg.dependencies['better-sqlite3'], 'server 依赖不含 better-sqlite3');

  console.log('\n4. 代码引用 sql.js 而非 better-sqlite3');
  const dbFile = fs.readFileSync(path.join(ROOT, 'server', 'src', 'db.js'), 'utf8');
  assert(dbFile.includes("require('sql.js')"), 'db.js 引用 sql.js');
  assert(!dbFile.includes('better-sqlite3'), 'db.js 不引用 better-sqlite3');

  console.log('\n5. install:all 脚本存在且无需原生编译参数');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert(!!rootPkg.scripts['install:all'], 'install:all 脚本存在');
  assert(!rootPkg.scripts['install:all'].includes('--build-from-source'), 'install:all 不含 --build-from-source');

  console.log('\n6. 健康检查接口可用（需后端已启动）');
  try {
    const health = await new Promise((resolve, reject) => {
      http.get('http://localhost:3001/api/health', res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }).on('error', reject);
    });
    assert(health.status === 200, `健康检查 200 (实际 ${health.status})`);
    assert(health.body.status === 'ok', `健康检查 status=ok (实际 ${health.body.status})`);
  } catch (e) {
    console.log('  SKIP  健康检查（后端未启动）');
  }

  console.log('\n7. README 快速开始链路说明与脚本命令一致');
  const readmeContent = fs.readFileSync(readme, 'utf8');
  assert(readmeContent.includes('npm run install:all'), 'README 含 install:all 命令');
  assert(readmeContent.includes('npm run seed'), 'README 含 seed 命令');
  assert(readmeContent.includes('npm run dev'), 'README 含 dev 命令');
  assert(readmeContent.includes('/api/health'), 'README 含健康检查路径');
  assert(readmeContent.includes('localhost:3001'), 'README 含后端端口 3001');
  assert(readmeContent.includes('localhost:5173'), 'README 含前端端口 5173');

  console.log(`\n======================`);
  console.log(`通过: ${passed}, 失败: ${failed}`);
  console.log(`======================`);

  process.exit(failed > 0 ? 1 : 0);
})();
