import { useEffect, useState, type ReactNode } from "react";
import { Button, Text, View } from "./taro-components";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { componentSchema, type FormValue } from "@cfp/base-chat-protocol";
import { ArtifactImage, useArtifactState } from "./artifact-components";
import { BottomSheet } from "./bottom-sheet";
import { useArtifactUi, type ArtifactIconName } from "./artifact-ui";

type PreviewIcon = Extract<
  ArtifactIconName,
  "squarePen" | "messageCircle" | "image" | "search"
>;

export function CompactCard({
  title,
  summary,
  meta,
  icon = "squarePen",
  preview,
  onClick,
  external = false,
  generatedTitle = false,
}: {
  title: string;
  summary?: string;
  meta: string;
  icon?: PreviewIcon;
  preview?: ReactNode;
  onClick: () => void;
  external?: boolean;
  generatedTitle?: boolean;
}) {
  const { renderIcon } = useArtifactUi();
  return (
    <Button
      className="control artifact-preview"
      ariaLabel={`查看${title}`}
      onClick={onClick}
      data-ai-external={external ? "true" : "false"}
    >
      {preview || (
        <View className="artifact-preview-icon">{renderIcon(icon)}</View>
      )}
      <View className="artifact-preview-copy">
        <Text
          className="artifact-preview-title"
          data-ai-generated={generatedTitle ? "true" : "false"}
        >
          {title}
        </Text>
        {summary && (
          <Text className="artifact-preview-summary" data-ai-generated="true">
            {summary.slice(0, 100)}
          </Text>
        )}
        <Text className="artifact-preview-meta">{meta}</Text>
      </View>
      <Text className="artifact-preview-arrow" aria-hidden>
        ›
      </Text>
    </Button>
  );
}

export function ArtifactPreview({
  surface,
  children,
}: {
  surface: SurfaceModel;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { labels } = useArtifactUi();
  const { values, submitted, sending, error, external } = useArtifactState();
  const components = Array.from(surface.componentsModel.entries).map(
    ([id, model]) =>
      componentSchema.parse(
        { id, component: model.type, ...model.properties },
        { jitless: true },
      ),
  );
  const title = components.find(
    (item) => item.component === "Text" && item.variant === "h3",
  );
  const fields = components.filter((item) => item.component === "FormField");
  const image = components.find((item) => item.component === "Image");
  const table = components.find((item) => item.component === "Table");
  const page = components.find((item) => item.component === "Page");
  const code = components.find((item) => item.component === "Code");
  const description = components.find(
    (item) => item.component === "Text" && item.variant !== "h3",
  );
  const name =
    title?.component === "Text" ? title.text : labels.detailsFallback;
  const filled = fields.filter((item) => filledValue(values[item.field.id])).length;
  const meta = fields.length
    ? sending
      ? labels.submitting
      : submitted
        ? "已完成 · 查看填写"
        : error
          ? "未提交 · 点开重试"
          : `${fields.length === 1 ? "简单问答" : `${fields.length} 个问题`} · ${filled ? `已填 ${filled} 项` : "点开填写"}`
    : image
      ? "图片 · 点开查看"
      : table
        ? `表格 · ${table.rows.length} 行`
        : page
          ? `阅读 · ${page.page.sections.length} 个部分`
          : code
            ? `代码 · ${code.code.language} · 只读`
            : "小卡片 · 点开查看";
  useEffect(() => {
    if (submitted) setOpen(false);
  }, [submitted]);
  return (
    <>
      <CompactCard
        generatedTitle
        external={external}
        title={name}
        summary={
          fields.length || image
            ? undefined
            : description?.component === "Text"
              ? description.text
              : page?.page.subtitle
        }
        meta={`${meta} · ${labels.generated}${external ? labels.external : ""}`}
        icon={
          fields.length === 1 ? "messageCircle" : image ? "image" : "squarePen"
        }
        preview={
          image ? (
            <ArtifactImage url={image.url} alt={image.alt} thumbnail />
          ) : undefined
        }
        onClick={() => setOpen(true)}
      />
      {open && (
        <BottomSheet
          title={name}
          generatedTitle
          external={external}
          onClose={() => setOpen(false)}
        >
          <View className="artifact-detail-single">{children}</View>
        </BottomSheet>
      )}
    </>
  );
}

function filledValue(value: FormValue | undefined) {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return true;
  if (!value) return false;
  if ("unknown" in value) return value.unknown;
  return value.optionIds.length > 0 || value.otherText !== undefined;
}
