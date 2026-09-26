# pku-opendata-mcp

把**北京大学开放研究数据平台**（<https://opendata.pku.edu.cn>，由北京大学图书馆运营的 Dataverse 实例，497 个数据集 / 8611 个数据文件）接成 MCP server，让 WorkBuddy、Claude Desktop、Cursor 等客户端可以直接检索。

零依赖、单文件、纯 Node 18+ 实现（用内建 `fetch`），不需要 `npm install`。

---

## 一、环境要求

- Node.js **18 以上**（用到全局 `fetch` 与 `AbortController`）
- 无需 API 密钥，无需注册，无需 Python 环境

---

## 二、提供 5 个工具

| 工具 | 作用 |
|---|---|
| `pku_platform_stats` | 返回数据集 / 文件总量与接口边界说明 |
| `pku_search_datasets` | 全文检索数据集，返回标题、DOI、发布日期、所属子库、着陆页 |
| `pku_search_files` | 文件级检索，返回 file_id、格式、字节数、md5、所属数据集 DOI |
| `pku_get_dataset` | 用 DOI 精确定位单条数据集记录 + 人类访问页 URL |
| `pku_dataset_files` | 枚举某个 DOI 下的数据文件（平台无此原生接口，本地过滤实现） |

### 调用示例（对话里直接说）

> 检索北大开放数据平台里的老年健康追踪调查数据

> 找一下 autism 相关的数据集，给出 DOI 和下载页

> 10.18170/DVN/VXPXUG 这个数据集有哪些文件，分别多大

---

## 三、已知边界（实测结论，务必知悉）

本平台**只对外开放 `/api/search` 这一个路径**，实测结果：

| 路径 | 状态 |
|---|---|
| `/api/search?q=...&type=dataset\|file` | **200 可用**，关键词检索、分页均有效 |
| `/api/datasets/{id}`、`/versions/latest/files` | 403 |
| `/api/files/{id}/metadata` | 403 |
| `/api/info/*`、`/api/metrics/*` | 403 |
| URL 中含 `:` 的 `persistentId` 写法 | 403（WAF 拦截） |

因此：

- ✅ 检索、定位、拿元数据、拿文件清单 —— 全部可用且免密钥
- ❌ **通过 API 直接下载文件内容** —— 平台未提供，本 server 不尝试绕过
- 受限数据集（Restricted-Use Data）必须在网页端注册后向发布者申请授权，这是平台的访问控制策略

下载请走返回的 DOI 着陆页（`https://doi.org/10.18170/DVN/XXXX`），在浏览器中完成。

---

## 四、安装到 WorkBuddy

### 方式 A：本地目录（最快，推荐先用这个）

编辑 `C:\Users\Administrator\.workbuddy\mcp.json`（**不是** `.mcp.json`，没有点前缀），把本目录的路径填进去：

```json
{
  "mcpServers": {
    "pku-opendata": {
      "command": "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe",
      "args": [
        "C:/Users/Administrator/WorkBuddy/2026-09-26-23-37-43/pku-opendata-mcp/index.js"
      ]
    }
  }
}
```

> 如果本机已有其他 MCP server，不要覆盖文件——只把 `pku-opendata` 这一条**合并**进已有的 `mcpServers` 对象里。
>
> Windows 下建议写 `node.exe` 的完整绝对路径。如果 `node` 已在系统 PATH 中，也可以直接写 `"command": "node"`。

### 方式 B：npm 全局安装

在本目录执行：

```bash
npm install -g .
```

然后把命令名写进配置：

```json
{
  "mcpServers": {
    "pku-opendata": {
      "command": "pku-opendata-mcp"
    }
  }
}
```

### 方式 C：发布到 npm 后一行接入（面向其他 WorkBuddy 用户）

维护者执行：

```bash
npm publish --access public
```

使用者只需：

```json
{
  "mcpServers": {
    "pku-opendata": {
      "command": "npx",
      "args": ["-y", "pku-opendata-mcp"]
    }
  }
}
```

### 方式 D：直接从 GitHub 分发

```json
{
  "mcpServers": {
    "pku-opendata": {
      "command": "npx",
      "args": ["-y", "github:<你的账号>/pku-opendata-mcp"]
    }
  }
}
```

---

## 五、启用步骤

写入 `mcp.json` 后，MCP server **不会自动生效**，还需要一步：

1. 完全退出并重启 WorkBuddy
2. 打开连接器管理页
3. 右上角找到自定义连接器入口，对新出现的 `pku-opendata` 点 **信任**
4. 之后在对话里即可用自然语言调用

---

## 六、其他客户端

Claude Desktop（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "pku-opendata": {
      "command": "node",
      "args": ["/absolute/path/to/pku-opendata-mcp/index.js"]
    }
  }
}
```

Cursor（`.cursor/mcp.json`）与 mcp.json 格式一致，直接套用即可。

---

## 七、本地自检

仓库里带了回归 fixture，无需启动客户端即可验证协议层：

```bash
node index.js < test-input.jsonl > test-output.jsonl 2>test-err.log
```

`index.js` 只向 **stdout** 输出 JSON-RPC 报文，所有日志走 stderr，不会污染协议。

---

## 八、发布前的邮箱隐私检查

**npm 会把维护者邮箱公开，且无法撤回。**

由于 npm 侧的暴露风险高于 GitHub，发布前请逐项确认：

| 检查项 | 要求 |
|---|---|
| `package.json` 的 `author` | 保持空字符串，**务必不要填邮箱** |
| `contributors` 字段 | 不要出现 email |
| npm 账号主邮箱 | 使用专用别名邮箱，不要用私人常用邮箱 |
| 本机 `git config user.email` | 用 GitHub noreply 地址 |
| GitHub 设置 | 勾选 Keep my email addresses private + Block command line pushes that expose my email |

设置本机提交邮箱（`<ID>` 见 GitHub → Settings → Emails）：

```bash
git config --global user.email "<ID>+<用户名>@users.noreply.github.com"
```

> npm 即使改用别名邮箱，历史版本的 maintainers 元数据里旧邮箱也会永久留存。首次发布前就把邮箱换好，代价最小。

## 九、许可

MIT。数据来源为北京大学开放研究数据平台，使用时请按其条款规范引用各数据集的 DOI。
