import { Text, View } from "@tarojs/components";
import { TabBar } from "@/components/TabBar";

export default function Today() {
  return (
    <View style={{ minHeight: "100vh", paddingBottom: "120px", padding: "32px 24px" }}>
      <Text style={{ fontSize: "44px", fontWeight: "bold" }}>今天</Text>
      <Text style={{ display: "block", color: "#687076", fontSize: "26px", marginTop: "16px" }}>
        「今天」聊天页即将上线（PR7b-3）。
      </Text>
      <TabBar active="today" />
    </View>
  );
}
