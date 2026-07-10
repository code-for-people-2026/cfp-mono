# Contract：共享 CMS `/api/internal/kiv1/*`

## 1. 身份 header

### Login bootstrap

- Header：`x-kith-inn-v1-internal: <KITH_INN_V1_INTERNAL_TOKEN>`。
- 仅 `POST /api/internal/kiv1/auth/operator-memberships` 接受。
- 缺失、空值、不匹配或 CMS 未配置：401/500 fail closed。

### Seller-scoped persistence

- Header：`x-kith-inn-v1-operator: <operator-jwt>`。
- CMS 使用独立 `KITH_INN_V1_JWT_SECRET` 验证 `kind=operator`、签名和 exp。
- CMS 随后查询 `kiv1_operators`：id=operatorId、seller=sellerId、active=true，并确认关联 `kiv1_sellers.status=active`；不匹配返回 403。
- seller 从 token stamp/filter；body 中出现 seller 必须返回 422，不得覆盖 token seller。

统一跨 seller 行为：404 `not-found`，不得区分“不存在”和“属于其他 seller”。

## 2. Login membership lookup

### `POST /api/internal/kiv1/auth/operator-memberships`

请求必须二选一：`{ "openid": "..." }` 或 `{ "operatorId": 1 }`。

200：

```json
{
  "memberships": [
    { "operatorId": 1, "sellerId": 7, "sellerName": "桃子", "active": true }
  ]
}
```

- openid 查询只返回 operator active 且 seller active 的 memberships，按 sellerName/sellerId 稳定排序。
- operatorId 查询用于 seller selection 二次确认；operator inactive 或 seller paused 返回空数组。
- 不返回 openid、旧 Admin/旧 seller 字段或其他 v1 数据。

## 3. Offerings

- `GET /api/internal/kiv1/offerings?active=all|true|false`
- `POST /api/internal/kiv1/offerings`
- `PATCH /api/internal/kiv1/offerings/:id`

POST/PATCH schema 与 shared offering API schema 一致；CMS 只做字段白名单、seller stamp/ownership 和 Payload 调用。同 seller unique 冲突规范化为 409。

## 4. Meal slots

- `GET /api/internal/kiv1/meal-slots?from=&to=`：seller filter，允许 BE 查询 7 日历史。
- `GET /api/internal/kiv1/meal-slots/:id`：seller-owned detail，供换菜前读取当前快照；跨 seller 仍返回 404。
- `POST /api/internal/kiv1/meal-slots`：创建一个完整 target snapshot；冲突 409。
- `PATCH /api/internal/kiv1/meal-slots/:id`：只允许 menuItems/generatedAt；先验证每个 offering 属于 token seller。

CMS 不生成菜单、不选择候选、不决定是否覆盖；BE 在用户确认后选择 POST 或 PATCH。

## 5. Customer profiles

### Seller snapshot

- `GET /api/internal/kiv1/seller`：按 token sellerId 返回 `id/name/defaultPriceCents/status`，供 BE 在创建/重提订单时解析单价；不接受 seller query/body。

### Profiles

- `GET /api/internal/kiv1/customer-profiles?query=`：seller+active filter。
- `POST /api/internal/kiv1/customer-profiles`：只允许 displayName/address，openid 固定为空。

M1 不提供 PATCH/DELETE。

## 6. Orders

- `GET /api/internal/kiv1/orders?mealSlotId=`：先验证 meal slot owner，再按 seller+mealSlot 查询。
- `POST /api/internal/kiv1/orders`：只允许 BE 已决策后的完整 snapshot；CMS 验证 mealSlot/customerProfile owner，seller stamp，unique 冲突 409。
- `PATCH /api/internal/kiv1/orders/:id`：seller-owned find 后，只允许 quantity、unitPriceCents、displayName、address、note、status/payment/delivery 与对应 timestamps 白名单。

CMS 不决定状态迁移；但仍运行 shared input schema、同 seller relationship guard，并拒绝 body 额外 relationship/seller 字段。

## 7. 错误与测试契约

- 400：非法 JSON/query。
- 401：bootstrap service token 或 operator JWT 无效。
- 403：token 有效但 membership 已停用/不匹配。
- 404：seller-owned record 未找到，包括跨 seller id。
- 409：数据库唯一冲突。
- 422：字段 schema/relationship 白名单不通过。
- 500：缺 secret 或 Payload 初始化失败；不得回退旧 secret。

每类 route 必须测试：无 header、错误 secret、错误 kind、过期 token、停用 membership、同 seller 成功、跨 seller 404、body seller 无法越权。旧 `/api/internal/*` 路径清单回归保持不变。
