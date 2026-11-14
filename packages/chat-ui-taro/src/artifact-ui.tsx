import {
  createContext,
  useContext,
  type ComponentType,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import type { TextProps } from "@tarojs/components";

export type ArtifactIconName =
  | "loaderCircle"
  | "squarePen"
  | "messageCircle"
  | "image"
  | "search"
  | "x"
  | "check"
  | "copy";

export type ArtifactTextProps = TextProps & {
  aiGenerated?: boolean;
  external?: boolean;
};

export interface ArtifactUiCopy {
  unavailable: string;
  loading: string;
  closeDetails: string;
  unknownChoice: string;
  otherChoice: string;
  optional: string;
  required: string;
  submitUnavailable: string;
  submitFailed: string;
  submitting: string;
  submitted: string;
  submittedNote: string;
  submitNote: string;
  copyCode: string;
  copied: string;
  copyFailed: string;
  generated: string;
  external: string;
  detailsFallback: string;
  unsupported: string;
  renderingFailed: string;
  loadingArtifact: string;
  previewCardAriaLabel(title: string): string;
  previewFormSubmitted(): string;
  previewFormError(): string;
  previewFormProgress(input: {
    fieldCount: number;
    filledCount: number;
  }): string;
  previewImage(): string;
  previewTable(rowCount: number): string;
  previewPage(sectionCount: number): string;
  previewCode(language: string): string;
  previewFallback(): string;
  imageCollectionTitle(imageCount: number): string;
  imageCollectionSummary(imageCount: number): string;
  imageCollectionDialogTitle(imageCount: number): string;
  detailNonGeneratedContent(): string;
}

export interface ArtifactUiConfig {
  Text: ComponentType<ArtifactTextProps>;
  Portal: ComponentType<{ children: ReactNode }>;
  resolveResource(url: string): Promise<string>;
  previewImage(source: string): void;
  openPage(url: string): void;
  copyText(value: string, external: boolean): Promise<void>;
  notify(message: string): void;
  renderIcon(name: ArtifactIconName): ReactNode;
  nativeSheet: {
    getWindowHeight(): number;
    onKeyboardHeightChange(listener: (event: { height: number }) => void): void;
    offKeyboardHeightChange(listener: (event: { height: number }) => void): void;
    onWindowResize(listener: () => void): void;
    offWindowResize(listener: () => void): void;
  };
  copy?: Partial<ArtifactUiCopy>;
}

const defaultCopy: ArtifactUiCopy = {
  unavailable: "图片暂不可用",
  loading: "图片加载中",
  closeDetails: "关闭详情",
  unknownChoice: "说不清",
  otherChoice: "补充你的说法",
  optional: "（选填）",
  required: " *",
  submitUnavailable: "表单暂时无法提交",
  submitFailed: "提交失败，请重试",
  submitting: "正在提交…",
  submitted: "已提交",
  submittedNote: "填写内容已保存到这段对话",
  submitNote: "只在点击提交后发送，也可以跳过这份练习",
  copyCode: "复制代码",
  copied: "已复制",
  copyFailed: "复制失败，重试",
  generated: "AI 生成作品",
  external: "（外部客户端声明）",
  detailsFallback: "回应作品",
  unsupported: "作品格式暂不支持，文字回复仍可阅读",
  renderingFailed: "作品暂时无法显示，文字回复仍可阅读",
  loadingArtifact: "正在整理作品…",
  previewCardAriaLabel: (title) => `查看${title}`,
  previewFormSubmitted: () => "已完成 · 查看填写",
  previewFormError: () => "未提交 · 点开重试",
  previewFormProgress: ({ fieldCount, filledCount }) =>
    `${fieldCount === 1 ? "简单问答" : `${fieldCount} 个问题`} · ${
      filledCount ? `已填 ${filledCount} 项` : "点开填写"
    }`,
  previewImage: () => "图片 · 点开查看",
  previewTable: (rowCount) => `表格 · ${rowCount} 行`,
  previewPage: (sectionCount) => `阅读 · ${sectionCount} 个部分`,
  previewCode: (language) => `代码 · ${language} · 只读`,
  previewFallback: () => "小卡片 · 点开查看",
  imageCollectionTitle: () => "这一组图片",
  imageCollectionSummary: (imageCount) => `${imageCount} 张图片`,
  imageCollectionDialogTitle: (imageCount) => `图片 · ${imageCount} 张`,
  detailNonGeneratedContent: () => "用户填写和原图除外",
};

const ArtifactUiContext = createContext<
  (ArtifactUiConfig & { labels: ArtifactUiCopy }) | undefined
>(undefined);

export function ArtifactUiProvider({
  config,
  children,
}: PropsWithChildren<{ config: ArtifactUiConfig }>) {
  return (
    <ArtifactUiContext.Provider
      value={{ ...config, labels: { ...defaultCopy, ...config.copy } }}
    >
      {children}
    </ArtifactUiContext.Provider>
  );
}

export function useArtifactUi() {
  const config = useContext(ArtifactUiContext);
  if (!config) throw new Error("ArtifactUiProvider is required");
  return config;
}
