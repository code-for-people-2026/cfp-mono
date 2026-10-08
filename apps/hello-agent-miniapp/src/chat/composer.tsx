import { useState } from "react";
import { Button, Image, Text, Textarea, View } from "@tarojs/components";
import { ChatIcon } from "./icon";
import { VoiceInput } from "./voice-input";
import type { Attachment } from "./model";

export type InputMode = "voice" | "keyboard";
export type ImageSource = "camera" | "album";

type ComposerProps = {
  inputMode: InputMode;
  text: string;
  attachments: Attachment[];
  disabled: boolean;
  voiceDisabled: boolean;
  ready: boolean;
  busy: boolean;
  uploading: boolean;
  onMode(mode: InputMode): void;
  onText(text: string): void;
  onVoiceText(text: string): void;
  onImage(source?: ImageSource): void;
  onRemoveImage(id: number): void;
  onSend(): void;
};

export function ChatComposer(props: ComposerProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const voice = props.inputMode === "voice";
  const hasDraft = !!props.text.trim() || props.attachments.length > 0;
  const imageDisabled =
    props.disabled || recording || props.attachments.length >= 3;
  const showSend = !voice && (hasDraft || props.busy);
  function chooseImage(source?: ImageSource) {
    if (imageDisabled) return;
    setToolsOpen(false);
    props.onImage(source);
  }

  return (
    <View className="chat-composer">
      {props.attachments.length > 0 && (
        <View className="attachments">
          {props.attachments.map((item, index) => (
            <View className="attachment" key={item.id}>
              <Image
                src={item.src}
                className="attachment-image"
                mode="aspectFill"
              />
              <Button
                className="control remove-image"
                ariaLabel={`移除第 ${index + 1} 张图片`}
                disabled={props.disabled || undefined}
                onClick={() => props.onRemoveImage(item.id)}
              >
                <ChatIcon name="x" inverted />
              </Button>
            </View>
          ))}
        </View>
      )}
      <View
        className={`composer ${voice ? "voice-composer" : "keyboard-composer"}`}
      >
        <Button
          className="control composer-action attach-button"
          ariaLabel="添加图片"
          disabled={imageDisabled || undefined}
          onClick={() => chooseImage()}
        >
          <ChatIcon name="camera" />
        </Button>
        {voice ? (
          <VoiceInput
            disabled={props.voiceDisabled || toolsOpen}
            onText={props.onVoiceText}
            onActiveChange={setRecording}
          />
        ) : (
          <Textarea
            className="text-input"
            value={props.text}
            onInput={(event) => props.onText(event.detail.value)}
            onFocus={() => setToolsOpen(false)}
            placeholder="发消息，聊聊你的烦心事…"
            maxlength={4000}
            autoHeight
            disabled={props.disabled}
          />
        )}
        <Button
          className={`control composer-action input-toggle ${voice ? "keyboard-toggle" : "voice-toggle"}`}
          ariaLabel={voice ? "切换到键盘输入" : "切换到语音输入"}
          onClick={() => {
            setToolsOpen(false);
            props.onMode(voice ? "keyboard" : "voice");
          }}
        >
          <ChatIcon name={voice ? "keyboard" : "audioLines"} />
        </Button>
        {showSend ? (
          <Button
            className={`control composer-action send-button ${!props.ready ? "is-disabled" : ""}`}
            ariaLabel={props.busy ? "正在发送" : "发送消息"}
            disabled={!props.ready || undefined}
            onClick={props.onSend}
          >
            <ChatIcon name="arrowUp" inverted />
          </Button>
        ) : (
          <Button
            className={`control composer-action more-button ${toolsOpen ? "is-open" : ""}`}
            ariaLabel={toolsOpen ? "收起图片工具" : "展开图片工具"}
            disabled={props.disabled || recording || undefined}
            onClick={() => setToolsOpen((open) => !open)}
          >
            <ChatIcon name="circlePlus" />
          </Button>
        )}
      </View>
      {props.uploading && <Text className="draft-note">正在添加图片…</Text>}
      {voice && !!props.text && (
        <Text className="draft-note">有未发送的文字，点键盘继续编辑</Text>
      )}
      {toolsOpen && (
        <View className="composer-tools">
          <View className="media-tools">
            <Button
              className="control media-tool"
              ariaLabel="从相册选择图片"
              disabled={imageDisabled || undefined}
              onClick={() => chooseImage("album")}
            >
              <View className="media-tool-icon">
                <ChatIcon name="image" />
              </View>
              <Text>相册</Text>
            </Button>
            <Button
              className="control media-tool"
              ariaLabel="拍照"
              disabled={imageDisabled || undefined}
              onClick={() => chooseImage("camera")}
            >
              <View className="media-tool-icon">
                <ChatIcon name="camera" />
              </View>
              <Text>拍照</Text>
            </Button>
            <Text className="media-limit">最多 3 张图片</Text>
          </View>
          <Text className="voice-privacy">
            语音由
            {process.env.TARO_ENV === "h5" ? "浏览器语音服务" : "微信同声传译"}
            识别，转成文字后由你确认发送
          </Text>
        </View>
      )}
    </View>
  );
}
