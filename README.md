# 小红书内容分发系统

将预生成的小红书内容（标题、正文、图片、话题）随机分发给每个访问用户，确保内容不重复，适用于小红书运营人员批量发布内容。

## 功能特性

- **内容随机分发** - 用户访问即获取一条专属内容，刷新不更换
- **一键复制** - 标题、正文、话题均支持一键复制到剪贴板
- **批量导入** - 支持 CSV、JSON、XLSX 格式批量导入内容
- **话题管理** - 话题数量可配置（1-10），自动随机选取
- **图片支持** - 内容可关联图片，用户可直接保存
- **管理后台** - 内容管理、话题配置、数据统计

## 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (sql.js)
- **前端**: 原生 HTML / CSS / JavaScript
- **文件处理**: multer（上传）、xlsx（Excel 解析）

## 快速开始

### 安装

```bash
pnpm install
```

### 启动

```bash
# 开发模式
pnpm dev

# 生产模式
pnpm start
```

服务启动后：
- 用户端: http://localhost:3000
- 管理后台: http://localhost:3000/admin

### 首次登录

默认管理员密码: `admin123`

**部署后请立即修改密码。**

## 项目结构

```
├── server.js                 # Express 服务入口
├── package.json
├── SPEC.md                   # 产品规格文档
├── API.md                    # API 规范文档
├── public/
│   ├── user/                 # 用户端页面
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   └── admin/
│       └── index.html        # 管理后台页面
├── uploads/                  # 图片上传目录（git 忽略）
└── data/                     # SQLite 数据库目录（git 忽略）
```

## 导入格式

### CSV

```csv
title,content,image_name
"示例标题","示例正文内容","image1.jpg"
```

### JSON

```json
[
  { "title": "标题", "content": "正文内容", "image": "image.jpg" }
]
```

### XLSX

第一列为标题，第二列为正文，第三列为图片文件名（可选）。第一行如果是表头会自动跳过。

## API 文档

详细的 API 接口说明请参阅 [API.md](API.md)。

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `CORS_ORIGIN` | `http://localhost:3000` | 允许的跨域来源 |

## 安全说明

- SQL 查询已使用参数化绑定，防止 SQL 注入
- 管理接口需要 Token 认证
- 文件上传限制类型和大小（10MB）
- 密码使用 SHA-256 哈希存储
- HTTP 响应添加了安全头部

## 许可证

本项目基于 [GPL-2.0](LICENSE) 许可证开源。
