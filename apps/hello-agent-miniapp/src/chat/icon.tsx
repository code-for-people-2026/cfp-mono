import { Image } from "@tarojs/components";
import camera from "lucide-static/icons/camera.svg?raw";
import keyboard from "lucide-static/icons/keyboard.svg?raw";
import audioLines from "lucide-static/icons/audio-lines.svg?raw";
import circlePlus from "lucide-static/icons/circle-plus.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import image from "lucide-static/icons/image.svg?raw";
import x from "lucide-static/icons/x.svg?raw";

const icons = { camera, keyboard, audioLines, circlePlus, arrowUp, image, x };
type IconName = keyof typeof icons;

// 按需打包 Lucide 的原始图标，用图片组件兼容 H5 和微信；不依赖远程字体或内联 SVG 标签。
export function ChatIcon({
  name,
  inverted = false,
}: {
  name: IconName;
  inverted?: boolean;
}) {
  const svg = icons[name].replaceAll(
    "currentColor",
    inverted ? "#ffffff" : "#263c35",
  );
  return (
    <Image
      className="chat-icon"
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
      mode="scaleToFill"
      aria-hidden
    />
  );
}
