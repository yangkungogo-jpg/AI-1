const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Ensure directories exist
const dirs = ['uploads', 'data'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const ALLOWED_IMAGE_EXTS = /\.(jpeg|jpg|png|gif|webp)$/i;
const ALLOWED_IMPORT_EXTS = /\.(csv|txt|json|xlsx|xls)$/i;

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_IMPORT_EXTS.test(ext)) {
      return cb(null, true);
    }
    if (ALLOWED_IMAGE_EXTS.test(ext) && /^image\//.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('文件类型不支持'));
  }
});

let db;
const DB_PATH = path.join(__dirname, 'data', 'content.db');

// Admin session tokens (in-memory, lost on restart)
const adminTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Auth middleware for admin routes
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ success: false, message: '未授权，请先登录' });
  }
  next();
}

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      image_path TEXT,
      topics TEXT,
      status TEXT DEFAULT 'available',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      distributed_at TEXT,
      distributed_to TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS topics_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      count INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const existingTopicsCount = db.exec("SELECT value FROM admin_config WHERE key = 'topics_count'")[0];
  if (!existingTopicsCount) {
    db.run("INSERT INTO admin_config (key, value) VALUES ('topics_count', '3')");
  }

  const existingPassword = db.exec("SELECT value FROM admin_config WHERE key = 'admin_password'")[0];
  if (!existingPassword) {
    const hashed = hashPassword('admin123');
    db.run("INSERT INTO admin_config (key, value) VALUES ('admin_password', ?)", [hashed]);
  }

  saveDatabase();
  console.log('数据库初始化完成');
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Safe query helpers using parameterized prepare/bind
function dbQueryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function dbQueryOne(sql, params = []) {
  const results = dbQueryAll(sql, params);
  return results[0] || null;
}

function dbExecParam(sql, params = []) {
  db.run(sql, params);
}

// Helper function to get topics for a content
function getTopicsForContent(count = 3) {
  const topics = dbQueryAll(
    'SELECT name FROM topics_config WHERE enabled = 1 ORDER BY RANDOM() LIMIT ?',
    [Math.max(1, Math.min(10, parseInt(count) || 3))]
  );
  return topics.map(row => row.name);
}

// ============ 用户端 API ============

// 获取并分配内容给用户
app.get('/api/content/assign', (req, res) => {
  const userId = req.query.userId;

  if (userId) {
    const content = dbQueryOne('SELECT * FROM contents WHERE distributed_to = ?', [userId]);
    if (content) {
      const topics = content.topics ? JSON.parse(content.topics) : [];
      let imageUrl = null;
      if (content.image_path) {
        imageUrl = content.image_path.startsWith('/uploads/')
          ? content.image_path
          : `/uploads/${content.image_path}`;
      }
      return res.json({
        success: true,
        content: {
          id: content.id,
          title: content.title,
          content: content.content,
          image_url: imageUrl,
          topics
        }
      });
    }
  }

  const availableContent = dbQueryOne("SELECT * FROM contents WHERE status = 'available' ORDER BY RANDOM() LIMIT 1");

  if (!availableContent) {
    return res.json({ success: false, message: '暂无内容' });
  }

  const topicsRow = dbQueryOne("SELECT value FROM admin_config WHERE key = 'topics_count'");
  const topicsConfig = topicsRow ? topicsRow.value : '3';
  const selectedTopics = getTopicsForContent(parseInt(topicsConfig));
  const newUserId = userId || uuidv4();

  dbExecParam(
    "UPDATE contents SET status = 'distributed', distributed_at = datetime('now'), distributed_to = ?, topics = ? WHERE id = ?",
    [newUserId, JSON.stringify(selectedTopics), availableContent.id]
  );
  saveDatabase();

  let imageUrl = null;
  if (availableContent.image_path) {
    imageUrl = availableContent.image_path.startsWith('/uploads/')
      ? availableContent.image_path
      : `/uploads/${availableContent.image_path}`;
  }

  res.json({
    success: true,
    content: {
      id: availableContent.id,
      title: availableContent.title,
      content: availableContent.content,
      image_url: imageUrl,
      topics: selectedTopics
    },
    userId: newUserId
  });
});

// 获取用户已分配的内容
app.get('/api/content/user/:userId', (req, res) => {
  const content = dbQueryOne('SELECT * FROM contents WHERE distributed_to = ?', [req.params.userId]);

  if (!content) {
    return res.json({ success: false, message: '未找到用户内容' });
  }

  const topics = content.topics ? JSON.parse(content.topics) : [];
  res.json({
    success: true,
    content: {
      id: content.id,
      title: content.title,
      content: content.content,
      image_url: content.image_path ? `/uploads/${content.image_path}` : null,
      topics
    }
  });
});

// ============ 管理后台 API ============

// 验证管理员密码
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: '请输入密码' });
  }

  const row = dbQueryOne("SELECT value FROM admin_config WHERE key = 'admin_password'");
  const hashed = hashPassword(password);

  if (row && row.value === hashed) {
    const token = generateToken();
    adminTokens.add(token);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 登出（使 token 失效）
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.headers['x-admin-token'];
  adminTokens.delete(token);
  res.json({ success: true });
});

// 获取统计数据
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalRow = dbQueryOne('SELECT COUNT(*) as count FROM contents');
  const distributedRow = dbQueryOne("SELECT COUNT(*) as count FROM contents WHERE status = 'distributed'");
  const availableRow = dbQueryOne("SELECT COUNT(*) as count FROM contents WHERE status = 'available'");
  const topicsRow = dbQueryOne('SELECT COUNT(*) as count FROM topics_config');

  res.json({
    success: true,
    stats: {
      total: totalRow ? totalRow.count : 0,
      distributed: distributedRow ? distributedRow.count : 0,
      available: availableRow ? availableRow.count : 0,
      topicsCount: topicsRow ? topicsRow.count : 0
    }
  });
});

// 获取内容列表
app.get('/api/admin/contents', requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const status = req.query.status;
  const offset = (page - 1) * limit;

  const VALID_STATUSES = ['available', 'distributed', 'disabled'];

  let contents, totalRow;
  if (status && VALID_STATUSES.includes(status)) {
    contents = dbQueryAll('SELECT * FROM contents WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [status, limit, offset]);
    totalRow = dbQueryOne('SELECT COUNT(*) as count FROM contents WHERE status = ?', [status]);
  } else {
    contents = dbQueryAll('SELECT * FROM contents ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    totalRow = dbQueryOne('SELECT COUNT(*) as count FROM contents');
  }

  res.json({
    success: true,
    contents,
    pagination: { page, limit, total: totalRow ? totalRow.count : 0 }
  });
});

// 创建单个内容
app.post('/api/admin/contents', requireAdmin, (req, res) => {
  const { title, content, image_url } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: '标题和内容不能为空' });
  }

  const imagePath = image_url ? image_url.replace('/uploads/', '') : null;
  dbExecParam('INSERT INTO contents (title, content, image_path) VALUES (?, ?, ?)', [title, content, imagePath]);

  const row = dbQueryOne('SELECT last_insert_rowid() as id');
  saveDatabase();
  res.json({ success: true, id: row ? row.id : null });
});

// 删除内容
app.delete('/api/admin/contents/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, message: '无效的ID' });
  }
  dbExecParam('DELETE FROM contents WHERE id = ?', [id]);
  saveDatabase();
  res.json({ success: true });
});

// 更新内容状态
app.put('/api/admin/contents/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, message: '无效的ID' });
  }

  const { status } = req.body;
  const VALID_STATUSES = ['available', 'distributed', 'disabled'];
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: '无效的状态' });
  }

  dbExecParam('UPDATE contents SET status = ? WHERE id = ?', [status, id]);
  saveDatabase();
  res.json({ success: true });
});

// 批量删除内容
app.post('/api/admin/contents/batch-delete', requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: '请提供要删除的ID列表' });
  }
  ids.forEach(id => {
    const numId = parseInt(id);
    if (!isNaN(numId)) {
      dbExecParam('DELETE FROM contents WHERE id = ?', [numId]);
    }
  });
  saveDatabase();
  res.json({ success: true, deleted: ids.length });
});

// 批量导入内容
app.post('/api/admin/contents/import', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传文件' });
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  let imported = 0;
  let failed = 0;
  const errors = [];

  try {
    let data = [];

    if (ext === '.csv' || ext === '.txt') {
      let fileContent = fs.readFileSync(filePath).toString('utf-8');
      fileContent = fileContent.replace(/^﻿/, '');

      function detectDelimiter(line) {
        const delimiters = [',', ';', '\t', '|'];
        let maxCount = 0;
        let detected = ',';
        for (const d of delimiters) {
          const count = (line.match(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          if (count > maxCount) {
            maxCount = count;
            detected = d;
          }
        }
        return detected;
      }

      const lines = fileContent.split(/\r?\n/).filter(line => line.trim());

      if (lines.length > 0) {
        const delimiter = detectDelimiter(lines[0]);

        function simpleParse(line) {
          return line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
        }

        const firstParts = simpleParse(lines[0]);
        const headerKeywords = ['title', '标题', '内容', 'content', 'subject', '正文', 'body'];
        const isHeader = headerKeywords.some(kw => firstParts[0].toLowerCase().includes(kw.toLowerCase()));

        for (let i = isHeader ? 1 : 0; i < lines.length; i++) {
          const parts = simpleParse(lines[i]);
          if (parts.length >= 2 && parts[0] && parts[1]) {
            const item = { title: parts[0], content: parts[1] };
            if (parts[2]) item.image = parts[2];
            data.push(item);
          }
        }
      }
    } else if (ext === '.json') {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(data)) data = [data];
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    data.forEach((item, index) => {
      try {
        const title = item.title || item.标题 || '';
        const content = item.content || item.正文 || item.内容 || '';
        const image = item.image || item.image_name || item.图片 || '';

        if (title && content) {
          dbExecParam('INSERT INTO contents (title, content, image_path) VALUES (?, ?, ?)', [title, content, image || null]);
          imported++;
        } else {
          failed++;
          errors.push(`第${index + 2}行：缺少标题或内容`);
        }
      } catch (e) {
        failed++;
        errors.push(`第${index + 2}行：导入失败`);
      }
    });

    saveDatabase();
  } catch (e) {
    return res.status(500).json({ success: false, message: '文件解析失败' });
  } finally {
    fs.unlinkSync(filePath);
  }

  res.json({ success: true, imported, failed, errors });
});

// 获取话题配置
app.get('/api/admin/topics', requireAdmin, (req, res) => {
  const topics = dbQueryAll('SELECT * FROM topics_config ORDER BY id');
  const configRow = dbQueryOne("SELECT value FROM admin_config WHERE key = 'topics_count'");
  const topicsCount = configRow ? parseInt(configRow.value) || 3 : 3;

  res.json({ success: true, topics, topicsCount });
});

// 添加话题
app.post('/api/admin/topics', requireAdmin, (req, res) => {
  const { name, count = 1 } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: '话题名称不能为空' });
  }

  try {
    dbExecParam('INSERT INTO topics_config (name, count) VALUES (?, ?)', [name.trim(), Math.max(1, parseInt(count) || 1)]);
    const row = dbQueryOne('SELECT last_insert_rowid() as id');
    saveDatabase();
    res.json({ success: true, id: row ? row.id : null });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      res.status(400).json({ success: false, message: '话题已存在' });
    } else {
      res.status(500).json({ success: false, message: '添加失败' });
    }
  }
});

// 更新话题
app.put('/api/admin/topics/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, message: '无效的ID' });
  }

  const { name, count, enabled } = req.body;

  if (name !== undefined) {
    dbExecParam('UPDATE topics_config SET name = ? WHERE id = ?', [name, id]);
  }
  if (count !== undefined) {
    dbExecParam('UPDATE topics_config SET count = ? WHERE id = ?', [parseInt(count) || 1, id]);
  }
  if (enabled !== undefined) {
    dbExecParam('UPDATE topics_config SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  saveDatabase();
  res.json({ success: true });
});

// 删除话题
app.delete('/api/admin/topics/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, message: '无效的ID' });
  }
  dbExecParam('DELETE FROM topics_config WHERE id = ?', [id]);
  saveDatabase();
  res.json({ success: true });
});

// 更新话题数量配置
app.put('/api/admin/config/topics-count', requireAdmin, (req, res) => {
  const count = Math.max(1, Math.min(10, parseInt(req.body.count) || 3));
  dbExecParam("INSERT OR REPLACE INTO admin_config (key, value) VALUES ('topics_count', ?)", [String(count)]);
  saveDatabase();
  res.json({ success: true });
});

// 批量导入话题
app.post('/api/admin/topics/import', requireAdmin, (req, res) => {
  const { topics } = req.body;

  if (!Array.isArray(topics)) {
    return res.status(400).json({ success: false, message: '请提供话题数组' });
  }

  let imported = 0;
  topics.forEach(topic => {
    if (typeof topic === 'string' && topic.trim()) {
      try {
        dbExecParam('INSERT OR IGNORE INTO topics_config (name) VALUES (?)', [topic.trim()]);
        imported++;
      } catch (e) {
        // Skip duplicates
      }
    }
  });

  saveDatabase();
  res.json({ success: true, imported });
});

// 获取导入模板
app.get('/api/admin/template/:type', requireAdmin, (req, res) => {
  const { type } = req.params;

  if (type === 'csv') {
    const template = 'title,content,image_name,topics\n"示例标题","示例正文内容","","穿搭,好物推荐"';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="import-template.csv"');
    res.send(template);
  } else if (type === 'json') {
    const template = JSON.stringify([
      { title: "示例标题", content: "示例正文内容", image: "", topics: ["穿搭", "好物推荐"] }
    ], null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="import-template.json"');
    res.send(template);
  } else {
    res.status(400).json({ success: false, message: '不支持的模板类型' });
  }
});

// 上传图片
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传图片' });
  }

  res.json({
    success: true,
    url: `/uploads/${req.file.filename}`,
    filename: req.file.filename
  });
});

// 清理已分发的内容（重置为可用）
app.post('/api/admin/reset-contents', requireAdmin, (req, res) => {
  dbExecParam("UPDATE contents SET status = 'available', distributed_to = NULL, topics = NULL WHERE status = 'distributed'");
  const row = dbQueryOne('SELECT changes() as c');
  saveDatabase();
  res.json({ success: true, reset: row ? row.c : 0 });
});

// 修改管理员密码
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: '请提供旧密码和新密码' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: '新密码长度不能少于6位' });
  }

  const row = dbQueryOne("SELECT value FROM admin_config WHERE key = 'admin_password'");
  if (!row || row.value !== hashPassword(oldPassword)) {
    return res.status(401).json({ success: false, message: '旧密码错误' });
  }

  dbExecParam("UPDATE admin_config SET value = ? WHERE key = 'admin_password'", [hashPassword(newPassword)]);
  saveDatabase();
  res.json({ success: true, message: '密码修改成功' });
});

// Serve user page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user', 'index.html'));
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// Start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 服务器运行中`);
    console.log(`   用户端: http://localhost:${PORT}`);
    console.log(`   管理后台: http://localhost:${PORT}/admin`);
    console.log(`   默认管理员密码: admin123`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});