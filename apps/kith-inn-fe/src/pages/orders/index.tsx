import { Text, View } from "@tarojs/components";
import { TabBar } from "@/components/TabBar";

export default function Orders() {
  return (
    <View style={{ minHeight: "100vh", paddingBottom: "120px", padding: "32px 24px" }}>
      <Text style={{ fontSize: "44px", fontWeight: "bold" }}>订单台账</Text>
      <Text style={{ display: "block", color: "#687076", fontSize: "26px", marginTop: "16px" }}>
        订单 tab 即将上线（PR7b-2）。
      </Text>
      <TabBar active="orders" />
    </View>
  );
}
