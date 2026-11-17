import { Image, View } from "@tarojs/components";
import danceSprite from "../assets/aj-dance-24.png";

export function DancingLoader() {
  return (
    <View aria-hidden className="dancing-loader">
      <View aria-hidden className="dancing-loader__mascot">
        <Image
          aria-hidden
          className="dancing-loader__sprite"
          src={danceSprite}
          mode="scaleToFill"
        />
      </View>
      <View aria-hidden className="dancing-loader__dots">
        <View
          aria-hidden
          className="dancing-loader__dot dancing-loader__dot--one"
        />
        <View
          aria-hidden
          className="dancing-loader__dot dancing-loader__dot--two"
        />
        <View
          aria-hidden
          className="dancing-loader__dot dancing-loader__dot--three"
        />
      </View>
    </View>
  );
}
