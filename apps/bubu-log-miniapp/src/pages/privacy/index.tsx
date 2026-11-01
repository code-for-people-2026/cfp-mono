import { Button, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { PrivacyCenter } from "../../privacy/PrivacyCenter";
import "../settings/settings.css";
export default function PrivacyPage() {
  const params = Taro.getCurrentInstance().router?.params;
  return <View className="page settings-page">{process.env.TARO_ENV === "h5" && <Button className="text-button" onClick={() => { void Taro.navigateBack(); }}>‹ 返回</Button>}<PrivacyCenter babyId={params?.babyId || undefined} authenticated={params?.guest !== "1"} /></View>;
}
