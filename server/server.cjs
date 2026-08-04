/**
 * 杖剑传说 KOC 内容机会决策与复盘工作台 V3
 * 端口: 4567  |  前端: Vue 3 + Vite (dev:5173 / prod:dist)
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const { initDb, getDb } = require('./db/database');
const seed = require('./db/seed');
const automation = require('./lib/automation');

const PORT = process.env.PORT || 4567;
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 生产环境：优先使用 Vue 构建产物 dist/，否则回退到 public/
const distDir = path.join(__dirname, '..', 'dist');
const publicDir = path.join(__dirname, '..', 'public');
const staticDir = fs.existsSync(distDir) ? distDir : publicDir;
if (staticDir === distDir) {
  console.log('[静态] 使用 Vue 构建产物: dist/');
}
app.use(express.static(staticDir));

(async () => {
  const db = await initDb();
  seed(db);

  // Gemini API Key（来自环境变量或数据库已有配置，不再硬编码）
  const k = db.prepare("SELECT value FROM settings WHERE key='gemini_api_key'").get();
  if (!k && process.env.GEMINI_API_KEY) {
    db.prepare("INSERT INTO settings (key,value) VALUES ('gemini_api_key', ?)").run(process.env.GEMINI_API_KEY);
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('gemini_model','gemini-2.0-flash')").run();
  }
  if (process.env.AI_API_KEY) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ai_api_key', ?)").run(process.env.AI_API_KEY);
  }
  if (process.env.AI_PROVIDER) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ai_provider', ?)").run(process.env.AI_PROVIDER);
  }
  if (process.env.AI_BASE_URL) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ai_base_url', ?)").run(process.env.AI_BASE_URL);
  }
  if (process.env.AI_MODEL) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ai_model', ?)").run(process.env.AI_MODEL);
  }
  // 模型默认值
  const m = db.prepare("SELECT value FROM settings WHERE key='gemini_model'").get();
  if (!m) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('gemini_model','gemini-2.0-flash')").run();
  }

  app.use('/api', require('./routes/api'));

  app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

  app.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      }
    }
    console.log('==========================================');
    console.log('  杖剑传说 KOC 工作台 V3 已启动');
    console.log(`  本机访问:   http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`  团队访问:   http://${ip}:${PORT}`));
    const autoStatus = automation.start(db);
    if (autoStatus.enabled) {
      console.log(`  自动任务:   每天 ${autoStatus.runTime} (${autoStatus.timezone})，下次 ${autoStatus.nextRunLocal || '待计算'}`);
    } else {
      console.log('  自动任务:   已关闭');
    }
    console.log('==========================================');
  });
})().catch(e => { console.error('启动失败:', e); process.exit(1); });
