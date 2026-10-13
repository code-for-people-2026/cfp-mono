import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Image,
  Input,
  ScrollView,
  Text,
  Textarea,
  View,
} from "@tarojs/components";
import Taro from "@tarojs/taro";
import {
  applyA2ui,
  artifactsSchema,
  formAction,
  toA2ui,
  validateForm,
  type ClientEvent,
  type Component,
  type FormValues,
  type Surface,
  type Surfaces,
} from "@cfp/hello-agent-protocol";
import { privateImageSource } from "./api";
import { MessageText } from "./message-text";

function ArtifactImage({ url, alt, external }: { url: string; alt: string; external: boolean }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    privateImageSource(url)
      .then((value) => {
        if (active) setSource(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <View>
      {source && !failed ? (
        <Image
          className="artifact-image"
          src={source}
          mode="widthFix"
          onError={() => setFailed(true)}
          onClick={() => Taro.previewImage({ urls: [source], current: source })}
        />
      ) : (
        <MessageText className="artifact-caption">
          {failed ? "图片暂时无法读取" : "正在取图片…"}
        </MessageText>
      )}
      <MessageText aiGenerated external={external} className="artifact-caption">{alt}</MessageText>
    </View>
  );
}

type Props = {
  external?: boolean;
  disabled?: boolean;
  onAction?: (action: ClientEvent) => Promise<void>;
  submitted?: boolean;
  initialValues?: FormValues;
};
function SurfaceView({
  surface,
  disabled,
  onAction,
  submitted,
  initialValues,
  external = false,
}: Props & { surface: Surface }) {
  const [values, setValues] = useState<FormValues>(
    initialValues || surface.values,
  );
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    // 历史刷新会重建同一表单的空 values，不能覆盖失败提交的本地答案。
    // 已保存的回应可恢复字段；没有交互入口的实时预览仍跟随数据模型。
    if (initialValues || !onAction) setValues(initialValues || surface.values);
  }, [surface.values, initialValues, onAction]);
  const locked = disabled || sending || submitted;
  async function submit() {
    if (locked || inFlight.current || !onAction) return;
    const fields = Object.values(surface.components).flatMap((component) =>
      component.component === "FormField" ? [component.field] : [],
    );
    const problem = validateForm(
      {
        kind: "form",
        id: "form",
        title: "",
        description: "",
        submitLabel: "",
        fields,
      },
      values,
    );
    setError(problem || "");
    if (problem) return;
    inFlight.current = true;
    setSending(true);
    try {
      await onAction(formAction(surface, values));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请重试");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  function render(id: string, ancestors: string[] = []): ReactNode {
    if (ancestors.includes(id) || ancestors.length > 8)
      return <Text key={id}>这部分作品无法显示</Text>;
    const component = surface.components[id];
    if (!component) return null;
    const next = [...ancestors, id];
    const child = (id: string) => render(id, next);
    switch (component.component) {
      case "Column":
        return (
          <View key={id} className="artifact-column">
            {component.children.map(child)}
          </View>
        );
      case "Card":
        return (
          <View key={id} className="artifact-card">
            {child(component.child)}
          </View>
        );
      case "Text":
        return (
          <MessageText
            key={id}
            aiGenerated external={external}
            className={`artifact-text artifact-${component.variant || "body"}`}
          >
            {component.text}
          </MessageText>
        );
      case "Image":
        return (
          <ArtifactImage key={id} url={component.url} alt={component.alt} external={external} />
        );
      case "Table":
        return (
          <ScrollView key={id} scrollX className="artifact-table-scroll">
            <View className="artifact-table">
              {[component.columns, ...component.rows].map((row, rowIndex) => (
                <View
                  key={rowIndex}
                  className={`artifact-table-row ${rowIndex === 0 ? "artifact-table-head" : ""}`}
                >
                  {row.map((cell, cellIndex) => (
                    <MessageText
                      key={cellIndex}
                      aiGenerated external={external}
                      className="artifact-table-cell"
                    >
                      {cell}
                    </MessageText>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      case "Page":
        return <PageView key={id} component={component} external={external} />;
      case "FormField": {
        const field = component.field;
        const fieldId = component.value.path.slice("/values/".length);
        const update = (value: string) =>
          setValues((current) => ({
            ...current,
            [fieldId]:
              field.type === "number" &&
              value.trim() !== "" &&
              Number.isFinite(Number(value))
                ? Number(value)
                : value,
          }));
        return (
          <View key={id} className="artifact-field">
            <MessageText className="artifact-label">
              {field.label}
              {field.required ? " *" : "（选填）"}
            </MessageText>
            {field.type === "longText" ? (
              <Textarea
                className="artifact-input artifact-textarea"
                value={String(values[fieldId] ?? "")}
                placeholder={field.placeholder || "写下你愿意分享的部分"}
                maxlength={1200}
                disabled={locked}
                onInput={(event) => update(event.detail.value)}
              />
            ) : (
              <Input
                className="artifact-input"
                type={field.type === "number" ? "digit" : "text"}
                value={String(values[fieldId] ?? "")}
                placeholder={
                  field.placeholder ||
                  (field.type === "number"
                    ? `${field.min ?? ""} ～ ${field.max ?? ""}`
                    : "在这里填写")
                }
                maxlength={1200}
                disabled={locked}
                onInput={(event) => update(event.detail.value)}
              />
            )}
          </View>
        );
      }
      case "Button":
        return (
          <View key={id}>
            {error && <Text className="artifact-error">{error}</Text>}
            <Button
              className="control artifact-submit"
              disabled={locked || !onAction || undefined}
              onClick={() => void submit()}
            >
              {submitted
                ? "已提交，阿 J 先生已接着回应"
                : sending
                  ? "正在提交…"
                  : child(component.child)}
            </Button>
            <MessageText className="artifact-caption">
              {submitted
                ? "填写内容已保存到这段对话"
                : "只在点击提交后发送，也可以跳过这份练习"}
            </MessageText>
          </View>
        );
    }
  }
  return <View className="artifact-surface" data-ai-external={external ? "true" : "false"}><Text className="artifact-caption">AI 生成作品{external ? "（外部客户端声明）" : ""} · 用户填写和原图除外</Text>{render("root")}</View>;
}

function PageView({
  component,
  external,
}: {
  component: Extract<Component, { component: "Page" }>;
  external: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sections = expanded
    ? component.page.sections
    : component.page.sections.slice(0, 1);
  return (
    <View className="artifact-page">
      {component.page.subtitle && (
        <MessageText aiGenerated external={external} className="artifact-caption">
          {component.page.subtitle}
        </MessageText>
      )}
      {sections.map((section, index) => (
        <View key={index} className="artifact-section">
          <MessageText aiGenerated external={external} className="artifact-heading">
            {section.heading}
          </MessageText>
          <MessageText aiGenerated external={external} className="artifact-text">{section.body}</MessageText>
          {section.items?.map((item, i) => (
            <MessageText aiGenerated external={external} key={i} className="artifact-text">
              {`• ${item}`}
            </MessageText>
          ))}
        </View>
      ))}
      {component.page.sections.length > 1 && (
        <Button
          className="control artifact-link"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起页面" : "展开整页"}
        </Button>
      )}
      {process.env.TARO_ENV === "h5" && (
        <Button
          className="control artifact-link"
          onClick={() => window.location.assign(component.url)}
        >
          打开独立页面 ↗
        </Button>
      )}
    </View>
  );
}

export function LiveArtifacts({ surfaces }: { surfaces: Surfaces }) {
  return (
    <View>
      {Object.values(surfaces).map((surface) => (
        <SurfaceView key={surface.id} surface={surface} disabled />
      ))}
    </View>
  );
}

export function Artifacts({
  turnId,
  artifacts,
  responses,
  ...props
}: Props & {
  turnId: number;
  artifacts: unknown;
  responses: Record<string, FormValues>;
}) {
  const parsed = useMemo(() => {
    const result = artifactsSchema.safeParse(artifacts ?? [], {
      jitless: true,
    });
    if (!result.success) return undefined;
    return toA2ui(turnId, result.data).reduce<Surfaces>(applyA2ui, {});
  }, [turnId, artifacts]);
  if (!parsed)
    return (
      <Text className="artifact-error">作品格式暂不支持，文字回复仍可阅读</Text>
    );
  return (
    <View>
      {Object.values(parsed).map((surface) => (
        <SurfaceView
          key={surface.id}
          surface={surface}
          {...props}
          submitted={!!responses[surface.id]}
          initialValues={responses[surface.id]}
        />
      ))}
    </View>
  );
}
