# Provider: wechat

微信公众平台（WeChat Official Account Platform）—— 本 Store 中与公众号相关的外部能力，其底层服务由该平台提供。

## 概览

| 项 | 说明 |
|---|---|
| Provider 标识 | `wechat` |
| 平台 | 微信公众平台（公众号后台） |
| 官方开放接口 | 有：HTTP JSON API，域名 `api.weixin.qq.com` |
| 官方 MCP / CLI | 无。截至 2026-10-02 未见官方 MCP 或 CLI；社区包均为第三方作品，且 `wechat-official-*` 这类命名里的 "Official Account" 是「公众号」的英文译名，**不代表官方出品** |
| 本 Store 下的能力 | [`wechat-draft-mcp`](../../mcp/wechat-draft-mcp/) |

## 认证模型（仅元数据）

- 类型：AppID + AppSecret 换取 `access_token`（服务端到服务端，不涉及用户 OAuth 授权）
- 推荐取 token 接口：`cgi-bin/stable_token`（配额 1 万次/分钟、50 万次/天；`cgi-bin/token` 新号仅 2000 次/天）
- 凭据来源：由调用方宿主以环境变量注入，约定变量名 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`。
  本仓库与实现代码均**不存储任何凭据值**，也不读取 `.env`。
- **出口 IP 白名单是强制的**：非白名单请求返回 `40164`，错误信息里带 `request_ip`。
  换 Wi-Fi、开 VPN 或重启光猫后 IP 会变，需要重新添加。
- 接口权限：以 公众号后台 → 设置与开发 → 接口权限 的实际授权为准。

## 已知平台约束（本项目实测）

> 以下为实测结论；与官方文档或社区说法不一致的部分，以实测为准。

| 结论 | 依据 |
|---|---|
| 文档写的 `content` 上限「2KB」不成立 | 实测 2.5KB / 59.5KB / 24.9KB 的正文全部创建成功 |
| 文档写的「2 万字符」限制不严格 | 实测 20100 字符仍然成功 |
| **未认证个人订阅号**可以使用草稿箱与正文图片 | 实测通过；社区普遍声称「需要认证」是错的 |
| 正文图片必须走 `media/uploadimg` | 不占素材库配额；仅 jpg/png 且单张小于 1MB |
| 封面必须走 `material/add_material` | `thumb_media_id` 只接受永久素材 |
| 外链图片会被微信过滤 | 草稿里会裂图，需要改成本地图片 |
| 先用宽松的「保险丝」，不要拿文档限值做硬拦截 | 照文档做 2KB 拦截会让真实文章一条都传不上去 |

## 参考

- 微信公众平台：<https://mp.weixin.qq.com/>
- 公众号接口文档：<https://developers.weixin.qq.com/doc/offiaccount/>
