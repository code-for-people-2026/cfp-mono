import { useEffect, useState, type ReactNode } from "react";
import { Button, Text, View } from "@tarojs/components";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { componentSchema } from "@cfp/hello-agent-protocol";
import { ArtifactImage, useArtifactState } from "./artifact-components";
import { BottomSheet } from "./bottom-sheet";
import { ChatIcon } from "./icon";

export function CompactCard({
  title,
  summary,
  meta,
  icon = "squarePen",
  preview,
  onClick,
}: {
  title: string;
  summary?: string;
  meta: string;
  icon?: "squarePen" | "messageCircle" | "image" | "search";
  preview?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      className="control artifact-preview"
      ariaLabel={`查看${title}`}
      onClick={onClick}
    >
      {preview || (
        <View className="artifact-preview-icon">
          <ChatIcon name={icon} />
        </View>
      )}
      <View className="artifact-preview-copy">
        <Text className="artifact-preview-title">{title}</Text>
        {summary && (
          <Text className="artifact-preview-summary">
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
  const { values, submitted, sending, error } = useArtifactState();
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
  const description = components.find(
    (item) => item.component === "Text" && item.variant !== "h3",
  );
  const name = title?.component === "Text" ? title.text : "回应作品";
  const filled = fields.filter(
    (item) => String(values[item.field.id] ?? "").trim() !== "",
  ).length;
  const meta = fields.length
    ? sending
      ? "正在提交…"
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
          : "小卡片 · 点开查看";
  useEffect(() => {
    if (submitted) setOpen(false);
  }, [submitted]);
  return (
    <>
      <CompactCard
        title={name}
        summary={
          fields.length || image
            ? undefined
            : description?.component === "Text"
              ? description.text
              : page?.page.subtitle
        }
        meta={meta}
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
        <BottomSheet title={name} onClose={() => setOpen(false)}>
          <View className="artifact-detail-single">{children}</View>
        </BottomSheet>
      )}
    </>
  );
}
