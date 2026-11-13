import { useState, type ReactNode } from "react";
import { Button, Image, Text, Textarea, View } from "./taro-components";
import type { VoiceInputProps } from "./voice-input";

export type InputMode = "voice" | "keyboard";
export type ImageSource = "camera" | "album";
export type ChatComposerIconName =
  | "camera"
  | "keyboard"
  | "audioLines"
  | "circlePlus"
  | "arrowUp"
  | "image"
  | "x";

export interface ChatComposerAttachment<Id extends number | string = number> {
  id: Id;
  src: string;
}

export interface ChatComposerCopy {
  addImage: string;
  removeImage(index: number): string;
  switchToKeyboard: string;
  switchToVoice: string;
  sending: string;
  send: string;
  openTools: string;
  closeTools: string;
  chooseAlbum: string;
  takePhoto: string;
  album: string;
  camera: string;
  uploading: string;
  voiceDraft: string;
}

const defaultComposerCopy: ChatComposerCopy = {
  addImage: "添加图片",
  removeImage: (index) => `移除第 ${index + 1} 张图片`,
  switchToKeyboard: "切换到键盘输入",
  switchToVoice: "切换到语音输入",
  sending: "正在发送",
  send: "发送消息",
  openTools: "展开图片工具",
  closeTools: "收起图片工具",
  chooseAlbum: "从相册选择图片",
  takePhoto: "拍照",
  album: "相册",
  camera: "拍照",
  uploading: "正在添加图片…",
  voiceDraft: "有未发送的文字，点键盘继续编辑",
};

type VoiceInputSlot = (
  props: Omit<VoiceInputProps, "createDriver" | "copy"> & {
    copy?: VoiceInputProps["copy"];
  },
) => ReactNode;

export interface ChatComposerProps<Id extends number | string> {
  inputMode: InputMode;
  text: string;
  attachments: ChatComposerAttachment<Id>[];
  disabled: boolean;
  voiceDisabled: boolean;
  ready: boolean;
  busy: boolean;
  uploading: boolean;
  placeholder: string;
  maxTextLength: number;
  maxAttachments: number;
  attachmentLimit: string;
  voicePrivacy: ReactNode;
  renderIcon(
    name: ChatComposerIconName,
    options?: { inverted?: boolean },
  ): ReactNode;
  voiceInput: VoiceInputSlot;
  copy?: Partial<ChatComposerCopy>;
  onMode(mode: InputMode): void;
  onText(text: string): void;
  onVoiceText(text: string): void;
  onImage(source?: ImageSource): void;
  onRemoveImage(id: Id): void;
  onSend(): void;
}

export function ChatComposer<Id extends number | string>(
  props: ChatComposerProps<Id>,
) {
  const copy = { ...defaultComposerCopy, ...props.copy };
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const voice = props.inputMode === "voice";
  const hasDraft = !!props.text.trim() || props.attachments.length > 0;
  const imageDisabled =
    props.disabled ||
    recording ||
    props.attachments.length >= props.maxAttachments;
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
                ariaLabel={copy.removeImage(index)}
                disabled={props.disabled || undefined}
                onClick={() => props.onRemoveImage(item.id)}
              >
                {props.renderIcon("x", { inverted: true })}
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
          ariaLabel={copy.addImage}
          disabled={imageDisabled || undefined}
          onClick={() => chooseImage()}
        >
          {props.renderIcon("camera")}
        </Button>
        {voice
          ? props.voiceInput({
              disabled: props.voiceDisabled || toolsOpen,
              onText: props.onVoiceText,
              onActiveChange: setRecording,
            })
          : (
              <Textarea
                className="text-input"
                value={props.text}
                onInput={(event: { detail: { value: string } }) =>
                  props.onText(event.detail.value)
                }
                onFocus={() => setToolsOpen(false)}
                placeholder={props.placeholder}
                maxlength={props.maxTextLength}
                autoHeight
                adjustPosition={
                  process.env.TARO_ENV === "h5" ? undefined : false
                }
                fixed={process.env.TARO_ENV !== "h5"}
                disabled={props.disabled}
              />
            )}
        <Button
          className={`control composer-action input-toggle ${voice ? "keyboard-toggle" : "voice-toggle"}`}
          ariaLabel={voice ? copy.switchToKeyboard : copy.switchToVoice}
          onClick={() => {
            setToolsOpen(false);
            props.onMode(voice ? "keyboard" : "voice");
          }}
        >
          {props.renderIcon(voice ? "keyboard" : "audioLines")}
        </Button>
        {showSend
          ? (
              <Button
                className={`control composer-action send-button ${!props.ready ? "is-disabled" : ""}`}
                ariaLabel={props.busy ? copy.sending : copy.send}
                disabled={!props.ready || undefined}
                onClick={props.onSend}
              >
                {props.renderIcon("arrowUp", { inverted: true })}
              </Button>
            )
          : (
              <Button
                className={`control composer-action more-button ${toolsOpen ? "is-open" : ""}`}
                ariaLabel={toolsOpen ? copy.closeTools : copy.openTools}
                disabled={props.disabled || recording || undefined}
                onClick={() => setToolsOpen((open) => !open)}
              >
                {props.renderIcon("circlePlus")}
              </Button>
            )}
      </View>
      {props.uploading && <Text className="draft-note">{copy.uploading}</Text>}
      {voice && !!props.text && (
        <Text className="draft-note">{copy.voiceDraft}</Text>
      )}
      {toolsOpen && (
        <View className="composer-tools">
          <View className="media-tools">
            <Button
              className="control media-tool"
              ariaLabel={copy.chooseAlbum}
              disabled={imageDisabled || undefined}
              onClick={() => chooseImage("album")}
            >
              <View className="media-tool-icon">
                {props.renderIcon("image")}
              </View>
              <Text>{copy.album}</Text>
            </Button>
            <Button
              className="control media-tool"
              ariaLabel={copy.takePhoto}
              disabled={imageDisabled || undefined}
              onClick={() => chooseImage("camera")}
            >
              <View className="media-tool-icon">
                {props.renderIcon("camera")}
              </View>
              <Text>{copy.camera}</Text>
            </Button>
            <Text className="media-limit">{props.attachmentLimit}</Text>
          </View>
          {props.voicePrivacy}
        </View>
      )}
    </View>
  );
}
