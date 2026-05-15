# API 规范文档

供内容编写与集成调用参考。

## 基本信息

- Base URL: `http://localhost:3000`
- 数据格式: JSON
- 认证方式: 管理接口通过 `X-Admin-Token` 请求头认证

---

## 用户端接口

### 获取内容

获取一条可用内容并分配给当前用户。同一用户多次请求返回已分配的相同内容。

```
GET /api/content/assign?userId={uuid}
```

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | 否 | 用户标识。首次不传会自动生成并返回 |

**响应 200**

```json
{
  "success": true,
  "content": {
    "id": 1,
    "title": "今日穿搭分享",
    "content": "今天穿了一件白色T恤...",
    "image_url": "/uploads/123456-abc.jpg",
    "topics": ["穿搭", "好物推荐"]
  },
  "userId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**响应 200（无可用内容）**

```json
{
  "success": false,
  "message": "暂无内容"
}
```

### 查询用户内容

通过 userId 查询已分配给该用户的内容。

```
GET /api/content/user/{userId}
```

**响应 200**

```json
{
  "success": true,
  "content": {
    "id": 1,
    "title": "今日穿搭分享",
    "content": "今天穿了一件白色T恤...",
    "image_url": "/uploads/123456-abc.jpg",
    "topics": ["穿搭", "好物推荐"]
  }
}
```

---

## 管理接口

以下接口均需在请求头中携带 Token：

```
X-Admin-Token: {token}
```

Token 通过登录接口获取。

### 登录

```
POST /api/admin/login
Content-Type: application/json

{ "password": "your-password" }
```

**响应 200**

```json
{ "success": true, "token": "hex-string" }
```

**响应 401**

```json
{ "success": false, "message": "密码错误" }
```

### 登出

```
POST /api/admin/logout
```

使当前 Token 失效。

---

## 内容管理

### 获取内容列表

```
GET /api/admin/contents?page=1&limit=20&status=available
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | int | 1 | 页码 |
| `limit` | int | 20 | 每页条数（最大 100） |
| `status` | string | - | 筛选状态：`available` / `distributed` / `disabled` |

**响应 200**

```json
{
  "success": true,
  "contents": [
    {
      "id": 1,
      "title": "标题",
      "content": "正文内容",
      "image_path": "123456-abc.jpg",
      "topics": null,
      "status": "available",
      "created_at": "2024-01-01 00:00:00",
      "distributed_at": null,
      "distributed_to": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### 创建内容

```
POST /api/admin/contents
Content-Type: application/json

{
  "title": "标题",
  "content": "正文内容",
  "image_url": "/uploads/image.jpg"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 标题 |
| `content` | string | 是 | 正文内容 |
| `image_url` | string | 否 | 图片路径，如 `/uploads/image.jpg` |

**响应 200**

```json
{ "success": true, "id": 123 }
```

### 删除内容

```
DELETE /api/admin/contents/{id}
```

**响应 200**

```json
{ "success": true }
```

### 批量删除

```
POST /api/admin/contents/batch-delete
Content-Type: application/json

{ "ids": [1, 2, 3] }
```

**响应 200**

```json
{ "success": true, "deleted": 3 }
```

### 更新内容状态

```
PUT /api/admin/contents/{id}
Content-Type: application/json

{ "status": "disabled" }
```

`status` 可选值：`available` / `distributed` / `disabled`

### 批量导入

```
POST /api/admin/contents/import
Content-Type: multipart/form-data

file: [CSV/JSON/XLSX 文件]
```

**响应 200**

```json
{
  "success": true,
  "imported": 50,
  "failed": 2,
  "errors": ["第3行：缺少标题或内容"]
}
```

### 重置分发状态

将所有已分发的内容重置为可用状态。

```
POST /api/admin/reset-contents
```

**响应 200**

```json
{ "success": true, "reset": 25 }
```

---

## 话题管理

### 获取话题列表

```
GET /api/admin/topics
```

**响应 200**

```json
{
  "success": true,
  "topics": [
    { "id": 1, "name": "穿搭", "count": 1, "enabled": 1 }
  ],
  "topicsCount": 3
}
```

### 添加话题

```
POST /api/admin/topics
Content-Type: application/json

{ "name": "好物推荐", "count": 1 }
```

### 更新话题

```
PUT /api/admin/topics/{id}
Content-Type: application/json

{ "name": "新名称", "count": 2, "enabled": 0 }
```

字段均为可选，传入哪个更新哪个。

### 删除话题

```
DELETE /api/admin/topics/{id}
```

### 批量导入话题

```
POST /api/admin/topics/import
Content-Type: application/json

{ "topics": ["穿搭", "好物推荐", "今日穿搭"] }
```

重复话题自动跳过。

### 设置话题数量

配置每个内容随机分配的话题数量。

```
PUT /api/admin/config/topics-count
Content-Type: application/json

{ "count": 5 }
```

`count` 范围：1-10

---

## 其他接口

### 上传图片

```
POST /api/admin/upload
Content-Type: multipart/form-data

image: [图片文件]
```

支持 JPG、PNG、GIF、WebP，最大 10MB。

**响应 200**

```json
{
  "success": true,
  "url": "/uploads/123456-abc.jpg",
  "filename": "123456-abc.jpg"
}
```

### 下载导入模板

```
GET /api/admin/template/csv
GET /api/admin/template/json
```

### 获取统计数据

```
GET /api/admin/stats
```

**响应 200**

```json
{
  "success": true,
  "stats": {
    "total": 100,
    "distributed": 30,
    "available": 70,
    "topicsCount": 15
  }
}
```

### 修改密码

```
POST /api/admin/change-password
Content-Type: application/json

{
  "oldPassword": "admin123",
  "newPassword": "new-password"
}
```

新密码长度不能少于 6 位。

---

## 错误响应格式

所有接口错误响应格式统一：

```json
{
  "success": false,
  "message": "错误描述"
}
```

常见状态码：
- `400` - 请求参数错误
- `401` - 未认证或认证失败
- `500` - 服务器内部错误
