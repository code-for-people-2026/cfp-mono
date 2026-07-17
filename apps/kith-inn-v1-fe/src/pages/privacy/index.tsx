import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";

export default function PrivacyNotice() {
  return (
    <View className="page privacy-page">
      <Text className="title">个人信息用途说明</Text>
      <View className="card privacy-card">
        <Text>称呼用于桃子识别您的预订登记，地址用于按约定送达。</Text>
        <Text>常用资料和登记记录只通过当前微信身份在当前商家下读取。</Text>
        <Text>
          首次使用新资料完成登记时，会保存为常用资料；修改已有资料时，只有选择“另存为新资料”才会额外保存，否则只用于本次登记。
        </Text>
        <Text>
          停用常用资料只会让它不再用于新的预订登记，不会物理删除，也不会改写历史登记记录。
        </Text>
        <Text>历史登记记录保留当时的称呼、地址、份数和状态，便于双方核对。</Text>
        <Text>不需要手机号、微信昵称或头像，也不提供在线支付。</Text>
      </View>
      <Text className="notice">
        本页是产品内用途说明，不代表微信后台隐私保护指引已经配置或审核通过。
      </Text>
      <Button onClick={() => void Taro.navigateBack()}>返回上一页</Button>
    </View>
  );
}
