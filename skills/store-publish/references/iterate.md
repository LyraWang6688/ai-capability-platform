# 迭代

> 前置：`reuse_scan.py` 确认注册表里**已有**这个资产。

## 0. 先读现状

- 它在哪个注册表？当前的 `status` / `version` / `updated` 是什么？
- 读目标实体本身，再动手（`AGENTS.md` 必读顺序第 9 项）。
- 按顺序重读 6 份契约——**规则可能已经变过**。

## 1. 判断改动级别

依据 `VERSIONING.md` §4：

| 级别 | 什么时候升 |
|---|---|
| **PATCH** | 向后兼容的修正 |
| **MINOR** | 向后兼容的能力新增 |
| **MAJOR** | 破坏性变更 / 行为不兼容 |

```
⚠️ VERSIONING.md 没有规定"谁有权升 MAJOR"。
   遇到 MAJOR 时【停下来问王颖】，不要自己决定。
```

## 2. 改内容

- **路径不变。** 升级版本不改目录（`VERSIONING.md` §3）。
- Skill：`SKILL.md` frontmatter 仍然只能用那 6 个字段；**不要因为升版本就去写 `version`**。
- External Capability：如果代码变了，确认 `implementation_path` 仍然指向对的目录。

## 3. 改注册表

```yaml
    version: <新版本号>
    updated: "YYYY-MM-DD"
```

**只改这两项（以及内容有变化时相应字段）。不要顺手改别的资产的记录。**

## 4. 验证（两道）

```bash
npx skills-ref validate <skill-path>
python3 <store>/scripts/validate_store.py
```

## 5. ⛔ 停下 —— 等人批准

列给王颖：改了什么、从哪个版本升到哪个版本、为什么是这个级别、校验结果。**等她同意。**

## 6. 提交 + 打 tag

- feature 分支 → PR（不直推 main）
- commit message：`update(skill): refine <skill-name>`（或 capability 对应写法）
- **合并后**打名字空间 tag：

```bash
git tag <asset-name>-v<X.Y.Z>
git push origin <asset-name>-v<X.Y.Z>
```

```
⚠️ 不要用 v0.1.0 这种全仓通用的 tag —— 一个仓库装多个资产，会撞车。
   （VERSIONING.md §6）
```

## 7. 不删历史

如果这次改动**推翻了旧判断**，按 `CONTRIBUTING_AI.md` 的方式记录演化，不要静默覆盖：

```
原判断
  ↓
发生了什么
  ↓
为什么改变
  ↓
新判断
```

**一个资产的历史版本由 tag 承载，永不删除**（`VERSIONING.md` §6）。"回滚到 v1.2.0" 是 `git checkout <asset>-v1.2.0`，不是删掉后面的版本。
