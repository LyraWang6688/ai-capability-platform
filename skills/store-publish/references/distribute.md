# 引用 / 分发

> 用途：王颖说「去 Store 找一下某个资产怎么用」时读这份。

## 先看注册表

注册表是**唯一事实源**——不要靠记忆或猜测。

```bash
python3 <skill-dir>/scripts/reuse_scan.py <asset-name> --detail
```

它会输出该资产的注册表条目（含 `status` / `version` / `implementation_path` 等）。

## Skill 怎么用

```bash
npx skills add https://github.com/LyraWang6688/ai-capability-store
```

- 仓库布局是平铺 `skills/<name>/`，命中 skills CLI 的发现规则。
- 客户端会按 `description` 判断**什么时候加载**这个 skill。

## MCP 怎么用

```
⚠️ 已知缺口：Store 的 external-capabilities/registry.yaml 目前只有自由文本的 auth 字段，
   没有结构化的 install / connect 字段。
```

行业标准（MCP 官方 `server.json`）已有现成字段，Store 尚未采纳：

| 要表达什么 | 标准字段 |
|---|---|
| 怎么装 | `packages[].registryType` / `identifier` / `version` |
| 怎么连 | `transport.type`（stdio / http） |
| 要什么凭证 | `environmentVariables[].name` / `isRequired` / **`isSecret`** |

**在这个缺口补上之前**，MCP 的"怎么装、怎么连"只能从 `provider_path` 指向的 provider README 里读。

**不要为了好看而假装这个缺口不存在**——如果 provider README 里没写清楚，如实告诉王颖"这个资产的接入方式没有记录"。

## 按版本引用

- **默认**：用注册表里的 `version`——那是 **Store 当前推荐版本**，不一定是"最新版本"（`VERSIONING.md` §5）。
- **需要精确复现**：钉到不可变 tag：

```bash
git checkout <asset-name>-v<X.Y.Z>
```

## 能力的可用性

看 `status`：

| status | 含义 |
|---|---|
| `available` | 可用 |
| `limited` | 可用但有限制（需要额外部署 / 人工授权 / 特定网络） |
| `disabled` | 不可用 |
| `unknown` | 未经确认 |

**`limited` 很常见，不要当成 `available` 用。** 具体限制看条目的 `notes` 和 provider README。
