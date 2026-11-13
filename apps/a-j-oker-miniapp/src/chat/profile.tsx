import { Image, Text, View } from "@tarojs/components";
import type { UserProfile } from "@cfp/a-j-oker-contracts";
import "./profile.css";

export function AccountAvatar({ profile, source }: { profile?: UserProfile; source?: string }) {
  return source ? <Image className="account-avatar" src={source} mode="aspectFill" /> :
    <View className="account-avatar" style={{ backgroundColor: profile?.avatar.color || "#e4eee5" }}><Text>{profile?.avatar.emoji || "🦦"}</Text></View>;
}
export function AccountProfile({ profile, source }: { profile: UserProfile; source?: string }) {
  return <View className="account-profile"><AccountAvatar profile={profile} source={source} /><Text className="account-name">{profile.nickname}</Text></View>;
}
