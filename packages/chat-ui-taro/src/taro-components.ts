// Keep the platform import behind one source module so host test runners can
// replace it without loading Taro's compile-time runtime globals. All exports
// retain the official component declarations from @tarojs/components.
export {
  Button,
  Image,
  Input,
  ScrollView,
  Text,
  Textarea,
  View,
} from "@tarojs/components";
