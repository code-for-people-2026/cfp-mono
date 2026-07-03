# 契约：kith-inn Offerings API（FE ↔ BE）

菜品池 CRUD。所有端点 `sellerAuth` 保护，operator JWT 经 `Authorization: Bearer <token>` 传入；BE 转发到 cms 时走 `x-kith-inn-operator`（seller-token 透传，无 admin key）。

## `GET /offerings`

菜品池页数据源。BE 已过滤 `kind === "component"`（含 active+inactive，供 FE 分区）。

### 响应

```json
{
  "offerings": [
    { "id": 12, "name": "番茄炒蛋", "kind": "component", "mainIngredient": "鸡蛋", "category": "veg", "active": true, "seller": 7 },
    { "id": 15, "name": "蒜蓉空心菜", "kind": "component", "mainIngredient": "青菜", "category": "veg", "active": false, "seller": 7 }
  ]
}
```

### 规则

- 返回所有 `kind=component` 的菜（**含 `active=false`**），每条带 `active` 标记；FE 按 `active` 分「菜品池」/「已停用」两区。
- 按 seller 隔离。

## `POST /offerings`

新增一道菜。

### 请求体

```json
{ "name": "蒜蓉空心菜", "mainIngredient": "青菜", "category": "veg" }
```

### 响应（201）

```json
{ "offering": { "id": 16, "name": "蒜蓉空心菜", "kind": "component", "mainIngredient": "青菜", "category": "veg", "active": true, "seller": 7 } }
```

### 规则

- `name` 必填非空、`category` 必填（限 meat/veg/soup/staple），否则 400。
- `mainIngredient` 可选。
- BE 用 `offeringCreateSchema` 校验；多余字段（priceCents/tags/recipe/kind/seller）被丢弃。
- BE → cms 强制 `kind=component`、`active=true`、seller 由 JWT 钉死；`category` 取自请求体。
- 重名允许（PRD 不要求菜名唯一；去重在主料层）。

## `PATCH /offerings/:id`

编辑菜名 / 主料 / 分类（原地改，保留 id）。

### 请求体

```json
{ "category": "meat" }
```

（name / mainIngredient / category 任选其一或多个）

### 响应（200）

```json
{ "offering": { "id": 12, "name": "番茄炒蛋", "kind": "component", "mainIngredient": "鸡蛋", "category": "meat", "active": true, "seller": 7 } }
```

### 规则

- BE 用 `offeringUpdateSchema` 校验；只接受 `name`/`mainIngredient`/`category`，其他字段忽略。
- 若 `name` 给了则非空；`category` 给了则须合法。
- 空请求体（无任何可改字段）→ 400。
- 跨租户（id 不属于当前 seller）→ 404。
- 不允许改 `kind`/`active`（active 由 DELETE/restore 管）。

## `DELETE /offerings/:id`

从菜品池移除一道菜（软停用 `active=false`）。

### 响应（200）

```json
{ "ok": true }
```

### 规则

- 内部 = `payload.update({ id, data: { active: false } })`；doc 仍在，引用方仍可读。
- 跨租户 → 404。
- 重复删除（已 active=false）→ 仍 200（幂等）。

## `POST /offerings/:id/restore`

恢复一道已停用的菜（`active=true`，重新进入菜品池 + 菜单候选）。

### 响应（200）

```json
{ "ok": true }
```

### 规则

- 内部 = `payload.update({ id, data: { active: true } })`。
- 跨租户 → 404。
- 重复恢复（已 active=true）→ 仍 200（幂等）。

## 错误

- 401：缺/无效 token。
- 400：请求体非法（name 空、category 缺失/非法、PATCH 无字段等）。
- 404：`PATCH`/`DELETE`/`restore` 的 id 不属于当前 seller。
- 502：cms 调用失败（BE → cms 非 2xx）。
