import { Image } from "@tarojs/components";
import camera from "lucide-static/icons/camera.svg?raw";
import keyboard from "lucide-static/icons/keyboard.svg?raw";
import audioLines from "lucide-static/icons/audio-lines.svg?raw";
import circlePlus from "lucide-static/icons/circle-plus.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import image from "lucide-static/icons/image.svg?raw";
import x from "lucide-static/icons/x.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";

import menu from "lucide-static/icons/menu.svg?raw";
import squarePen from "lucide-static/icons/square-pen.svg?raw";
import messageCircle from "lucide-static/icons/message-circle.svg?raw";
import search from "lucide-static/icons/search.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import heart from "lucide-static/icons/heart.svg?raw";
import chevronLeft from "lucide-static/icons/chevron-left.svg?raw";

const icons = {
  chevronLeft,
  menu,
  squarePen,
  messageCircle,
  search,
  settings,
  heart,
  camera,
  keyboard,
  audioLines,
  circlePlus,
  arrowUp,
  image,
  x,
  copy,
};
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
