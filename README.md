# 棱镜 AI · 数字服务商店

面向个人和小团队的 AI 服务商店。商城、游客订单、卡密验证和后台共享一个 SQLite 数据库。使用 Node.js 24 自带的 HTTP 和 SQLite 模块，应用无 npm 依赖。

## 本地体验

```bash
DEMO_MODE=1 ADMIN_PASSWORD='local-demo-admin-passphrase' npm start
```

打开 `http://127.0.0.1:3000`。默认体验模式使用内存数据库，退出后清空。测试支付不会扣款。后台位于 `/admin`。

右上方提供商品搜索、订单查询、浅色与深色主题、购物车、中英文切换和顾客登录。顾客可用邮箱和密码注册，登录后购买的订单会显示在「我的订单」。以前的游客订单仍可使用订单号、购买邮箱和查询密码找回。语言切换覆盖商城界面和示例内容，后台录入的自定义文案按原文显示。首版顾客账户暂未接入邮件找回密码。

1. 在「AI 工作台」选择「三次服务」，加入购物车并下单。保存邮箱、查询密码和订单号。
2. 点「确认测试支付」，复制订单页上的卡密。
3. 在 `/verify` 查询 3 次余额并提交兑换。在后台点击「开始处理」，然后完成服务或退回额度。待处理的任务也可以由持卡人在验证页取消。
4. 退出当前访问会话后，可在 `/guest/orders` 凭订单号、邮箱、查询密码找回卡密。

后台支持编辑商品、注册 SKU、导入已有授权码、手工批量发卡、撤销自营卡、补货后重试订单、管理兑换和发布内容。自营卡一次兑换代表一项服务请求。管理员处理服务后可将结果登记到订单关联的卡密，用户在验证页查询。授权码商品通过订单中配置的官方 HTTPS 入口使用。

## 编辑商品

登录 `/admin`，打开「商品与规格」。展开商品名称可修改标题、分类、摘要、服务说明、封面样式和上架状态，再点「保存商品」。已有商品地址可继续使用。

展开对应 SKU 可修改规格名称、价格、自营卡次数和有效天数，再点「保存规格」。价格以人民币分输入，例如 ¥29.00 填 `2900`。同一商品的多个规格可以分别定价，已有订单使用下单时保存的价格与交付规则。

## 部署到自有服务器

生成并妥善保存一份密钥。

```bash
openssl rand -hex 32
```

将配置写入服务器私有文件，并使用 `chmod 600` 限制访问。常用环境变量如下。

- `APP_KEY` 用于加密交付内容、查询卡密和签发会话。至少 32 字符。密钥与数据库一起备份，恢复必须使用原密钥。
- `ADMIN_PASSWORD` 设置后台登录口令，至少 12 字符。后台从创建第一个商品开始配置。
- `PUBLIC_ORIGINS` 为允许提交表单的 HTTPS 源，逗号分隔，如 `https://shop.example.com,https://verify.example.com`。
- `COOKIE_SECURE=1` 使 Cookie 只经 HTTPS 发送。
- `DATABASE_PATH` 指定 SQLite 文件。直接运行默认为 `data/store.sqlite`，容器默认为 `/app/data/store.sqlite`。
- `DEMO_MODE` 在体验环境设为 `1`。正式环境保持关闭。正式站需要通过后台录入实际商品，或在空数据库中显式使用 `SEED_DEMO=1` 加载示例目录。
- `CHECKOUT_URL` 和 `PAYMENT_SECRET` 对接真实支付适配器，配置方式见下节。正式环境未配置适配器时商城保留浏览入口，结算暂停。

```bash
docker build -t prism-ai-store .
docker volume create prism-ai-data
docker run -d --name prism-ai-store --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3000:3000 \
  -v prism-ai-data:/app/data prism-ai-store
```

让 Caddy 或 Nginx 终止 TLS，并反向代理到 `127.0.0.1:3000`。可单独映射验证子域名，并将根路径重定向到 `/verify`。让反代覆盖客户端提供的 `X-Real-IP`，填写其在应用所见的源地址到 `TRUSTED_PROXY_IPS`（逗号分隔）。直接同机运行通常是 `127.0.0.1`，Docker 桥接通常是容器网络的网关地址，可用 `docker inspect prism-ai-store` 确认。配置后限流按客户端 IP 执行。

使用 SQLite 在线备份或停机后备份整个数据卷。备份包含订单和交付信息，应与应用密钥一起纳入恢复流程并限制访问权限。

## 真实支付适配器

首版已提供应用与商户适配器之间的签名协议。接入微信、支付宝或其他渠道时，由适配器创建支付交易并验证渠道原生回调。站内测试支付直接调用同一项订单结算事务。商户适配器在真实渠道确认足额收款后通知商城。

- 用户从订单详情进入 `CHECKOUT_URL`。查询参数包括 `orderId`、`amount`（整数分）、`currency`（`CNY`）和 `signature`，签名是 `checkout:<orderId>:<amount>:<currency>` 的 HMAC-SHA256 十六进制值。适配器应验签，按订单号幂等创建交易，支付页面结束后可引导用户返回商城的 `/guest/orders/<orderId>`。
- 适配器向商城 `POST /webhooks/payment` 发送 JSON `{"eventId":"unique-provider-payment-id","orderId":"ORDER_ID","amount":2900,"currency":"CNY"}`。`X-Payment-Signature` 是使用 `PAYMENT_SECRET` 对原始 HTTP 请求体计算的 HMAC-SHA256 十六进制值。真实支付使用独立、至少 32 字符的随机密钥。
- 接口返回 `fulfilled` 表示已发货，`paid` 表示已收款等待补货。相同支付流水可安全重试。同一订单出现第二笔支付流水时返回 `409`，由适配器对账。已收款缺货订单补货后可在后台重试。接入具体渠道时，在其沙箱中先确认支付、重复通知和异常订单的处理。

## 验证

```bash
npm test
```

测试覆盖页面入口、下单、游客订单访问、支付金额和签名校验、重复支付、发卡、库存竞争、数据库持久化、兑换额度与管理操作。
