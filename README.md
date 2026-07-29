# 开源日见

一个每天自动寻找 GitHub 热门开源应用、生成中文简介并发布为网页的小项目。

## 它会做什么

- 每天北京时间 08:30 自动运行。
- 从 GitHub 官方 API 获取近期活跃、受欢迎的公开仓库。
- 优先选择具有实际产品形态的项目，过滤教程、资料清单、课程、数据集等内容。
- 根据近期活跃度、Star、增长速度和“应用属性”计算综合热度。
- 英文项目通过 OpenAI-compatible 文本接口翻译并整理为中文。
- 自动更新 `data/repos.json`，随后部署到 GitHub Pages。

## 最简单的发布方法（推荐）

1. 安装并登录 GitHub Desktop。
2. 把本项目文件夹直接拖进 GitHub Desktop。
3. 点击 **Publish repository**。
4. 取消勾选 **Keep this code private**，再次点击 **Publish repository**。
5. 到仓库 `Settings → Pages`，将 Source 设为 **GitHub Actions**。

项目已经初始化为 Git 仓库，无需使用终端，也无需自己提交文件。

## 部署步骤

### 1. 新建 GitHub 仓库

把整个项目文件夹上传到一个新的 GitHub 仓库，默认分支使用 `main`。

### 2. 开启 GitHub Pages

进入仓库：

`Settings → Pages → Build and deployment → Source → GitHub Actions`

### 3. 配置翻译接口

进入：

`Settings → Secrets and variables → Actions → New repository secret`

添加下面三个 Secret：

| Secret 名称 | 内容 |
|---|---|
| `TRANSLATE_API_URL` | OpenAI-compatible 的 Chat Completions 地址，例如以 `/v1` 或 `/chat/completions` 结尾 |
| `TRANSLATE_API_KEY` | 翻译模型 API Key |
| `TRANSLATE_MODEL` | 你当前账号可用的文本模型名称 |

API Key 只保存在 GitHub Secrets 中，不会写进 HTML，也不会暴露给网页访客。

### 4. 首次手动运行

进入仓库的 `Actions` 页面，打开“每日开源应用精选”，点击：

`Run workflow → Run workflow`

运行结束后，页面会自动生成中文项目数据并发布。

## 修改每天运行时间

文件位置：`.github/workflows/daily.yml`

当前配置：

```yaml
- cron: "30 0 * * *"
```

GitHub Actions 的 cron 使用 UTC。当前值代表北京时间每天 08:30。

## 本地预览

直接双击 `index.html` 也能打开。若还没有生成 `data/repos.json`，网页会临时读取 GitHub 实时数据，但实时备用数据不会自动翻译。

更稳定的本地方式：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 自定义数量

编辑 `.github/workflows/daily.yml` 中的：

```yaml
MAX_ITEMS: "18"
```

建议设置为 12–30。数量越多，README 请求和翻译消耗越高。

## Mac 一键部署

下载并解压项目后，双击：

```text
一键部署到GitHub.command
```

脚本会通过 GitHub 官方网页登录授权，自动完成：创建仓库、推送代码、启用 GitHub Pages、配置翻译接口 Secrets、启动首次工作流。API Key 不会写入项目文件或 Git 历史。
