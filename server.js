const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const XLSX = require('xlsx');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // 导入功能允许 CSV、TXT、JSON、XLSX 文件
    const importExts = /csv|txt|json|xlsx|xls/;
    const importName = file.originalname;
    if (importName && importExts.test(path.extname(importName).toLowerCase())) {
      return cb(null, true);
    }
    // 图片上传只允许图片
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('文件类型不支持'));
  }
});

let db;
const DB_PATH = path.join(__dirname, 'data', 'content.db');

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
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

  // Initialize default config
  const existingTopicsCount = db.exec("SELECT value FROM admin_config WHERE key = 'topics_count'")[0];
  if (!existingTopicsCount) {
    db.run("INSERT INTO admin_config (key, value) VALUES ('topics_count', '3')");
  }

  const existingPassword = db.exec("SELECT value FROM admin_config WHERE key = 'admin_password'")[0];
  if (!existingPassword) {
    db.run("INSERT INTO admin_config (key, value) VALUES ('admin_password', 'admin123')");
  }

  saveDatabase();
  console.log('数据库初始化完成');
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper function to get topics for a content
function getTopicsForContent(count = 3) {
  const result = db.exec(`SELECT name FROM topics_config WHERE enabled = 1 ORDER BY RANDOM() LIMIT ${parseInt(count)}`);
  if (!result.length || !result[0].values.length) return [];
  // 返回不带#的话题名称
  return result[0].values.map(row => row[0]);
}

// ============ 用户端 API ============

// 获取并分配内容给用户
app.get('/api/content/assign', (req, res) => {
  const userId = req.query.userId;

  // 如果用户已经有分配的内容，直接返回
  if (userId) {
    const result = db.exec(`SELECT * FROM contents WHERE distributed_to = '${userId.replace(/'/g, "''")}'`);
    if (result.length && result[0].values.length) {
      const row = result[0].values[0];
      const columns = result[0].columns;
      const content = {};
      columns.forEach((col, i) => content[col] = row[i]);

      const topics = content.topics ? JSON.parse(content.topics) : [];
      // 构建图片 URL
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
          topics: topics
        }
      });
    }
  }

  // 获取一个可用的内容
  const result = db.exec("SELECT * FROM contents WHERE status = 'available' ORDER BY RANDOM() LIMIT 1");

  if (!result.length || !result[0].values.length) {
    return res.json({ success: false, message: '暂无内容' });
  }

  const row = result[0].values[0];
  const columns = result[0].columns;
  const availableContent = {};
  columns.forEach((col, i) => availableContent[col] = row[i]);

  // 分配内容给用户
  const topicsResult = db.exec("SELECT value FROM admin_config WHERE key = 'topics_count'");
  const topicsConfig = topicsResult.length && topicsResult[0].values.length ? topicsResult[0].values[0][0] : '3';
  const selectedTopics = getTopicsForContent(parseInt(topicsConfig));
  const newUserId = userId || uuidv4();

  db.run(`UPDATE contents SET status = 'distributed', distributed_at = datetime('now'), distributed_to = '${newUserId}', topics = '${JSON.stringify(selectedTopics).replace(/'/g, "''")}' WHERE id = ${availableContent.id}`);
  saveDatabase();

  // 构建图片 URL
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
  const userId = req.params.userId.replace(/'/g, "''");
  const result = db.exec(`SELECT * FROM contents WHERE distributed_to = '${userId}'`);

  if (!result.length || !result[0].values.length) {
    return res.json({ success: false, message: '未找到用户内容' });
  }

  const row = result[0].values[0];
  const columns = result[0].columns;
  const content = {};
  columns.forEach((col, i) => content[col] = row[i]);

  const topics = content.topics ? JSON.parse(content.topics) : [];
  res.json({
    success: true,
    content: {
      id: content.id,
      title: content.title,
      content: content.content,
      image_url: content.image_path ? `/uploads/${content.image_path}` : null,
      topics: topics
    }
  });
});

// ============ 管理后台 API ============

// 验证管理员密码
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const result = db.exec("SELECT value FROM admin_config WHERE key = 'admin_password'");

  if (result.length && result[0].values.length && result[0].values[0][0] === password) {
    res.json({ success: true, token: 'admin-session' });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 获取统计数据
app.get('/api/admin/stats', (req, res) => {
  const totalResult = db.exec('SELECT COUNT(*) as count FROM contents');
  const total = totalResult.length && totalResult[0].values.length ? totalResult[0].values[0][0] : 0;

  const distributedResult = db.exec("SELECT COUNT(*) as count FROM contents WHERE status = 'distributed'");
  const distributed = distributedResult.length && distributedResult[0].values.length ? distributedResult[0].values[0][0] : 0;

  const availableResult = db.exec("SELECT COUNT(*) as count FROM contents WHERE status = 'available'");
  const available = availableResult.length && availableResult[0].values.length ? availableResult[0].values[0][0] : 0;

  const topicsResult = db.exec('SELECT COUNT(*) as count FROM topics_config');
  const topicsCount = topicsResult.length && topicsResult[0].values.length ? topicsResult[0].values[0][0] : 0;

  res.json({
    success: true,
    stats: { total, distributed, available, topicsCount }
  });
});

// 获取内容列表
app.get('/api/admin/contents', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const status = req.query.status;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM contents';
  let countQuery = 'SELECT COUNT(*) as count FROM contents';

  if (status) {
    query += ` WHERE status = '${status}'`;
    countQuery += ` WHERE status = '${status}'`;
  }

  query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

  const contents = db.exec(query);
  const totalResult = db.exec(countQuery);
  const total = totalResult.length && totalResult[0].values.length ? totalResult[0].values[0][0] : 0;

  const resultList = [];
  if (contents.length && contents[0].values.length) {
    const columns = contents[0].columns;
    contents[0].values.forEach(row => {
      const item = {};
      columns.forEach((col, i) => item[col] = row[i]);
      resultList.push(item);
    });
  }

  res.json({
    success: true,
    contents: resultList,
    pagination: { page, limit, total }
  });
});

// 创建单个内容
app.post('/api/admin/contents', (req, res) => {
  const { title, content, image_url } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: '标题和内容不能为空' });
  }

  const imagePath = image_url ? image_url.replace('/uploads/', '') : null;
  db.run(`INSERT INTO contents (title, content, image_path) VALUES ('${title.replace(/'/g, "''")}', '${content.replace(/'/g, "''")}', ${imagePath ? `'${imagePath}'` : 'NULL'})`);

  const result = db.exec('SELECT last_insert_rowid() as id');
  const id = result.length && result[0].values.length ? result[0].values[0][0] : null;

  saveDatabase();
  res.json({ success: true, id });
});

// 删除内容
app.delete('/api/admin/contents/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM contents WHERE id = ${id}`);
  saveDatabase();
  res.json({ success: true });
});

// 批量删除内容
app.post('/api/admin/contents/batch-delete', (req, res) => {
  const { ids } = req.body;
  ids.forEach(id => db.run(`DELETE FROM contents WHERE id = ${id}`));
  saveDatabase();
  res.json({ success: true, deleted: ids.length });
});

// 批量导入内容
app.post('/api/admin/contents/import', upload.single('file'), (req, res) => {
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
      let content = fs.readFileSync(filePath).toString('utf-8');

      // 移除BOM
      content = content.replace(/^﻿/, '');

      // 自动检测分隔符
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

      const lines = content.split(/\r?\n/).filter(line => line.trim());

      if (lines.length > 0) {
        const delimiter = detectDelimiter(lines[0]);

        // 简单解析
        function simpleParse(line) {
          const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
          return parts;
        }

        // 检查第一行是否是表头（英文或中文表头都跳过）
        const firstParts = simpleParse(lines[0]);
        const headerKeywords = ['title', '标题', '内容', 'content', 'subject', '正文', 'body'];
        const isHeader = headerKeywords.some(kw => firstParts[0].toLowerCase().includes(kw.toLowerCase()));

        const startIndex = isHeader ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
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
          db.run(`INSERT INTO contents (title, content, image_path) VALUES ('${title.replace(/'/g, "''")}', '${content.replace(/'/g, "''")}', ${image ? `'${image}'` : 'NULL'})`);
          imported++;
        } else {
          failed++;
          errors.push(`第${index + 2}行：缺少标题或内容`);
        }
      } catch (e) {
        failed++;
        errors.push(`第${index + 2}行：${e.message}`);
      }
    });

    saveDatabase();

  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  } finally {
    fs.unlinkSync(filePath);
  }

  res.json({
    success: true,
    imported: imported,
    failed: failed,
    errors: errors
  });
});

// 获取话题配置
app.get('/api/admin/topics', (req, res) => {
  const result = db.exec('SELECT * FROM topics_config ORDER BY id');
  const topicsResult = db.exec("SELECT value FROM admin_config WHERE key = 'topics_count'");
  const topicsCount = topicsResult.length && topicsResult[0].values.length ? topicsResult[0].values[0][0] : '3';

  const topics = [];
  if (result.length && result[0].values.length) {
    const columns = result[0].columns;
    result[0].values.forEach(row => {
      const item = {};
      columns.forEach((col, i) => item[col] = row[i]);
      topics.push(item);
    });
  }

  res.json({ success: true, topics, topicsCount: parseInt(topicsCount) });
});

// 添加话题
app.post('/api/admin/topics', (req, res) => {
  const { name, count = 1 } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, message: '话题名称不能为空' });
  }

  try {
    db.run(`INSERT INTO topics_config (name, count) VALUES ('${name.replace(/'/g, "''")}', ${count})`);
    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result.length && result[0].values.length ? result[0].values[0][0] : null;
    saveDatabase();
    res.json({ success: true, id });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      res.status(400).json({ success: false, message: '话题已存在' });
    } else {
      res.status(500).json({ success: false, message: e.message });
    }
  }
});

// 更新话题
app.put('/api/admin/topics/:id', (req, res) => {
  const { id } = req.params;
  const { name, count, enabled } = req.body;

  const updates = [];
  if (name !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`);
  if (count !== undefined) updates.push(`count = ${count}`);
  if (enabled !== undefined) updates.push(`enabled = ${enabled}`);

  if (updates.length > 0) {
    db.run(`UPDATE topics_config SET ${updates.join(', ')} WHERE id = ${id}`);
    saveDatabase();
  }

  res.json({ success: true });
});

// 删除话题
app.delete('/api/admin/topics/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM topics_config WHERE id = ${id}`);
  saveDatabase();
  res.json({ success: true });
});

// 更新话题数量配置
app.put('/api/admin/config/topics-count', (req, res) => {
  const { count } = req.body;
  db.run(`INSERT OR REPLACE INTO admin_config (key, value) VALUES ('topics_count', '${count}')`);
  saveDatabase();
  res.json({ success: true });
});

// 批量导入话题
app.post('/api/admin/topics/import', (req, res) => {
  const { topics } = req.body;

  if (!Array.isArray(topics)) {
    return res.status(400).json({ success: false, message: '请提供话题数组' });
  }

  let imported = 0;
  topics.forEach(topic => {
    try {
      db.run(`INSERT OR IGNORE INTO topics_config (name) VALUES ('${topic.trim().replace(/'/g, "''")}')`);
      imported++;
    } catch (e) {
      // Skip duplicates
    }
  });

  saveDatabase();
  res.json({ success: true, imported });
});

// 获取导入模板
app.get('/api/admin/template/:type', (req, res) => {
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
  }
});

// 上传图片
app.post('/api/admin/upload', upload.single('image'), (req, res) => {
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
app.post('/api/admin/reset-contents', (req, res) => {
  db.run("UPDATE contents SET status = 'available', distributed_to = NULL, topics = NULL WHERE status = 'distributed'");
  const result = db.exec('SELECT changes() as c');
  const changes = result.length && result[0].values.length ? result[0].values[0][0] : 0;
  saveDatabase();
  res.json({ success: true, reset: changes });
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
  res.status(500).json({ success: false, message: err.message });
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