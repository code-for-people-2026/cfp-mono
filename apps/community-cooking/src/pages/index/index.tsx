import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import ScreenContainer from "@/components/ScreenContainer";
import "./index.css";

export default function IndexPage() {
  return (
    <ScreenContainer>
      <Text className="eyebrow">Code for People</Text>
      <Text className="title">社区做饭</Text>
      <Text className="body">
        和邻里一起，一周吃什么不用愁。菜品由社区在后台维护，菜单一键生成。
      </Text>
      <View
        className="cta"
        onClick={() => Taro.navigateTo({ url: "/pages/menu/index" })}
      >
        <Text className="cta-text">生成本周菜单</Text>
      </View>
    </ScreenContainer>
  );
}
