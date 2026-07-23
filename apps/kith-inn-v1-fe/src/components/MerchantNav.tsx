import { Button, View } from "@tarojs/components";
import Taro from "@tarojs/taro";

const items = [
  ["home", "今日", "/pages/merchant/home/index"],
  ["offerings", "菜品", "/pages/merchant/offerings/index"],
  ["menu", "菜单", "/pages/merchant/menu/index"],
  ["orders", "订单", "/pages/merchant/orders/index"]
] as const;

export function MerchantNav({ active }: { active: typeof items[number][0] }) {
  return <View className="merchant-nav">{items.map(([key, label, url]) => (
    <Button key={key} className={key === active ? "active" : ""} disabled={key === active}
      onClick={() => void Taro.redirectTo({ url })}>{label}</Button>
  ))}</View>;
}
