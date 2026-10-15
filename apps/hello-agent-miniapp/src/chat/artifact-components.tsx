import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  A2UI_VERSION,
  clientEventSchema,
  componentSchema,
  formValuesSchema,
  validateForm,
  type ClientEvent,
  type Component,
  type FormValues,
} from "@cfp/hello-agent-protocol";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { privateImageSource } from "./api";
import { MessageText } from "./message-text";
import { useSheetFieldFocus } from "./bottom-sheet";

export function ArtifactImage({
  url,
  alt,
  thumbnail = false,
  external = false,
}: {
  url: string;
  alt: string;
  thumbnail?: boolean;
  external?: boolean;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource("");
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
    <View className={thumbnail ? "artifact-thumbnail" : "artifact-image-full"}>
      {source && !failed ? (
        <Image
          className={thumbnail ? "artifact-thumbnail-image" : "artifact-image"}
          src={source}
          mode={thumbnail ? "aspectFill" : "widthFix"}
          onError={() => setFailed(true)}
          onClick={
            thumbnail
              ? undefined
              : () => Taro.previewImage({ urls: [source], current: source })
          }
        />
      ) : (
        <MessageText className="artifact-caption">
          {failed ? "图片暂不可用" : "加载中…"}
        </MessageText>
      )}
      {!thumbnail && (
        <MessageText
          aiGenerated
          external={external}
          className="artifact-caption"
        >
          {alt}
        </MessageText>
      )}
    </View>
  );
}

export type ArtifactProps = {
  external?: boolean;
  disabled?: boolean;
  onAction?: (action: ClientEvent) => Promise<void>;
  submitted?: boolean;
  initialValues?: FormValues;
};
type Dispatch = (action: {
  event: { name: string; context: { values: FormValues } };
}) => void | Promise<void>;
const ArtifactContext = createContext<{
  external: boolean;
  values: FormValues;
  update: (path: string, value: string | number) => void;
  locked: boolean;
  canSubmit: boolean;
  submitted?: boolean;
  sending: boolean;
  error: string;
  submit: (dispatch: Dispatch) => Promise<void>;
} | null>(null);
export function useArtifactState() {
  const context = useContext(ArtifactContext);
  if (!context) throw new Error("作品未初始化");
  return context;
}

// Drafts and confirmed answers are product state, independent of renderer choice.
export function ArtifactState({
  surface,
  disabled,
  onAction,
  submitted,
  initialValues,
  external = false,
  children,
}: ArtifactProps & { surface: SurfaceModel; children: ReactNode }) {
  const modelValues = surface.dataModel.get("/values");
  const [values, setValues] = useState<FormValues>(
    () =>
      initialValues ||
      formValuesSchema.parse(modelValues || {}, { jitless: true }),
  );
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const actionHandler = useRef(onAction);
  actionHandler.current = onAction;
  useEffect(() => {
    // A history refresh must not replace unsent/failed answers with server defaults.
    const sync = (value: unknown) => {
      if (initialValues || !onAction)
        setValues(
          initialValues ||
            formValuesSchema.parse(value || {}, { jitless: true }),
        );
    };
    sync(surface.dataModel.get("/values"));
    const subscription = surface.dataModel.subscribe("/values", sync);
    return () => subscription.unsubscribe();
  }, [surface, initialValues, onAction]);
  useEffect(() => {
    if (initialValues) surface.dataModel.set("/values", initialValues);
  }, [surface, initialValues]);
  useEffect(() => {
    const subscription = surface.onAction.subscribe(async (action) => {
      if (!actionHandler.current) return;
      try {
        await actionHandler.current(
          clientEventSchema.parse(
            { version: A2UI_VERSION, action },
            { jitless: true },
          ),
        );
      } catch (cause) {
        // web_core's event emitter catches listener errors. Handle the failure
        // here so both hosts keep answers and show an actionable retry message.
        setError(cause instanceof Error ? cause.message : "提交失败，请重试");
      }
    });
    return () => subscription.unsubscribe();
    // Keep one listener during an async dispatch: web_core iterates a mutable Set,
    // so replacing a listener mid-submit would also deliver to the new listener.
  }, [surface]);
  const locked = !!(disabled || sending || submitted);
  async function submit(dispatch: Dispatch) {
    if (locked || inFlight.current || !onAction) return;
    const fields = Array.from(surface.componentsModel.entries).flatMap(
      ([id, model]) => {
        const component = componentSchema.parse(
          { id, component: model.type, ...model.properties },
          { jitless: true },
        );
        return component.component === "FormField" ? [component.field] : [];
      },
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
      await dispatch({ event: { name: "submit_form", context: { values } } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请重试");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  return (
    <ArtifactContext.Provider
      value={{
        external,
        values,
        locked,
        canSubmit: !!onAction,
        submitted,
        sending,
        error,
        submit,
        update: (path, value) => {
          if (locked) return;
          surface.dataModel.set(path, value);
          setValues((current) => ({
            ...current,
            [path.slice("/values/".length)]: value,
          }));
        },
      }}
    >
      {children}
    </ArtifactContext.Provider>
  );
}

// One native component catalog for both hosts; traversal and state belong to A2UI.
export function ArtifactComponent({
  component,
  child,
  dispatch,
}: {
  component: Component;
  child: (id: string) => ReactNode;
  dispatch: Dispatch;
}) {
  const context = useArtifactState();
  const focusField = useSheetFieldFocus();
  const {
    values,
    locked,
    canSubmit,
    submitted,
    sending,
    error,
    submit,
    external,
  } = context;
  const id = component.id;
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
          aiGenerated
          external={external}
          className={`artifact-text artifact-${component.variant || "body"}`}
        >
          {component.text}
        </MessageText>
      );
    case "Image":
      return (
        <ArtifactImage
          key={id}
          url={component.url}
          alt={component.alt}
          external={external}
        />
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
                    aiGenerated
                    external={external}
                    key={cellIndex}
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
        context.update(
          component.value.path,
          field.type === "number" &&
            value.trim() !== "" &&
            Number.isFinite(Number(value))
            ? Number(value)
            : value,
        );
      return (
        <View
          key={id}
          id={`artifact_field_${fieldId}`}
          className="artifact-field"
        >
          <MessageText
            aiGenerated
            external={external}
            className="artifact-label"
          >
            {`${field.label}${field.required ? " *" : "（选填）"}`}
          </MessageText>
          {field.type === "longText" ? (
            <Textarea
              className="artifact-input artifact-textarea"
              value={String(values[fieldId] ?? "")}
              placeholder={field.placeholder || "写下你愿意分享的部分"}
              maxlength={1200}
              disabled={locked}
              adjustPosition={false}
              onFocus={() => focusField(`artifact_field_${fieldId}`)}
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
              adjustPosition={false}
              onFocus={() => focusField(`artifact_field_${fieldId}`)}
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
            disabled={locked || !canSubmit || undefined}
            onClick={() => void submit(dispatch)}
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

function PageView({
  component,
  external,
}: {
  component: Extract<Component, { component: "Page" }>;
  external: boolean;
}) {
  return (
    <View className="artifact-page">
      {component.page.subtitle && (
        <MessageText
          aiGenerated
          external={external}
          className="artifact-caption"
        >
          {component.page.subtitle}
        </MessageText>
      )}
      {component.page.sections.map((section, index) => (
        <View key={index} className="artifact-section">
          <MessageText
            aiGenerated
            external={external}
            className="artifact-heading"
          >
            {section.heading}
          </MessageText>
          <MessageText
            aiGenerated
            external={external}
            className="artifact-text"
          >
            {section.body}
          </MessageText>
          {section.items?.map((item, i) => (
            <MessageText
              aiGenerated
              external={external}
              key={i}
              className="artifact-text"
            >
              {`• ${item}`}
            </MessageText>
          ))}
        </View>
      ))}
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
