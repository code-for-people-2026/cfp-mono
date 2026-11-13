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
} from "./taro-components";
import {
  A2UI_VERSION,
  clientEventSchema,
  componentSchema,
  formValuesSchema,
  validateForm,
  type ClientEvent,
  type Component,
  type FormValue,
  type FormValues,
} from "@cfp/base-chat-protocol";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { useArtifactUi } from "./artifact-ui";
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
  const { Text: MessageText, labels, renderIcon, resolveResource, previewImage } =
    useArtifactUi();
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    setSource("");
    setFailed(false);
    setLoaded(false);
    resolveResource(url).then(
      (value) => {
        if (active) setSource(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [url, resolveResource]);
  return (
    <View className={thumbnail ? "artifact-thumbnail" : "artifact-image-full"}>
      <View
        className={`artifact-image-frame${!loaded && !failed ? " is-loading" : ""}`}
      >
        {source && !failed && (
          <Image
            className={thumbnail ? "artifact-thumbnail-image" : "artifact-image"}
            src={source}
            mode={thumbnail ? "aspectFit" : "widthFix"}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            onClick={thumbnail ? undefined : () => previewImage(source)}
          />
        )}
        {!loaded && !failed && (
          <View className="artifact-image-loading" aria-label={labels.loading}>
            <View className="artifact-image-spinner">
              {renderIcon("loaderCircle")}
            </View>
          </View>
        )}
        {failed && (
          <MessageText className="artifact-caption">
            {labels.unavailable}
          </MessageText>
        )}
      </View>
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

type SubmitAction = Extract<Component, { component: "Button" }>["action"];
type Dispatch = (action: {
  event: {
    name: ClientEvent["action"]["name"];
    context: Pick<ClientEvent["action"]["context"], "values" | "form">;
  };
}) => void | Promise<void>;

const ArtifactContext = createContext<{
  external: boolean;
  values: FormValues;
  update: (path: string, value: FormValue) => void;
  report: (message: string) => void;
  locked: boolean;
  canSubmit: boolean;
  submitted?: boolean;
  sending: boolean;
  error: string;
  submit: (dispatch: Dispatch, action: SubmitAction) => Promise<void>;
} | null>(null);

export function useArtifactState() {
  const context = useContext(ArtifactContext);
  if (!context) throw new Error("ArtifactState is required");
  return context;
}

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
  const [values, setValues] = useState<FormValues>(() =>
    initialValues
      ? initialValues
      : formValuesSchema.parse(modelValues || {}, { jitless: true }),
  );
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const actionHandler = useRef(onAction);
  actionHandler.current = onAction;
  const { labels } = useArtifactUi();

  useEffect(
    () => () => {
      generation.current++;
      inFlight.current = false;
    },
    [],
  );
  useEffect(() => {
    const sync = (value: unknown) => {
      // Interactive local answers survive a history refresh. Confirmed answers
      // or read-only streams continue following the official data model.
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
      const current = generation.current;
      try {
        await actionHandler.current(
          clientEventSchema.parse(
            { version: A2UI_VERSION, action },
            { jitless: true },
          ),
        );
      } catch (cause) {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : labels.submitFailed);
      }
    });
    return () => subscription.unsubscribe();
  }, [surface, labels.submitFailed]);

  const locked = !!(disabled || sending || submitted);
  async function submit(dispatch: Dispatch, action: SubmitAction) {
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
    const current = generation.current;
    inFlight.current = true;
    setSending(true);
    try {
      await dispatch({
        event: {
          ...action.event,
          context: { ...action.event.context, values },
        },
      });
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : labels.submitFailed);
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setSending(false);
      }
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
        report: setError,
        update: (path, value) => {
          if (locked) return;
          setError("");
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
  const {
    Text: MessageText,
    labels,
    copyText,
    notify,
    renderIcon,
  } = useArtifactUi();
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
                    {tableCellText(cell)}
                  </MessageText>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case "Page":
      return (
        <PageView key={id} component={component} external={external} />
      );
    case "Code":
      return (
        <View key={id} className="artifact-code-frame">
          <MessageText
            aiGenerated
            external={external}
            className="artifact-caption artifact-code-language"
          >
            {component.code.language}
          </MessageText>
          <ScrollView scrollX className="artifact-code-scroll">
            <MessageText
              aiGenerated
              external={external}
              className="artifact-code-text"
              style={{ whiteSpace: "pre" }}
            >
              {component.code.code}
            </MessageText>
          </ScrollView>
          <CopyControl
            value={component.code.code}
            external={external}
            label={labels.copyCode}
            copyText={copyText}
            notify={notify}
            renderIcon={renderIcon}
            copied={labels.copied}
            failed={labels.copyFailed}
          />
        </View>
      );
    case "FormField": {
      const field = component.field;
      const fieldId = component.value.path.slice("/values/".length);
      const answer = values[fieldId];
      const selection =
        answer && typeof answer === "object" && !("unknown" in answer)
          ? answer
          : undefined;
      const maxChoices =
        field.type === "multiSelect"
          ? (field.maxChoices ??
            field.options.length + (field.allowOther ? 1 : 0))
          : 1;
      const choiceCount =
        (selection?.optionIds.length ?? 0) +
        (selection?.otherText === undefined ? 0 : 1);
      const selectOption = (optionId: string) => {
        if (locked) return;
        if (field.type !== "select" && field.type !== "multiSelect") return;
        if (field.type === "select") {
          context.update(
            component.value.path,
            selection?.optionIds[0] === optionId
              ? { optionIds: [] }
              : { optionIds: [optionId] },
          );
          return;
        }
        const current = selection?.optionIds ?? [];
        const selected = current.includes(optionId);
        if (!selected && choiceCount >= maxChoices) {
          context.report(`最多选择 ${maxChoices} 项`);
          return;
        }
        context.update(component.value.path, {
          optionIds: selected
            ? current.filter((value) => value !== optionId)
            : [...current, optionId],
          ...(selection?.otherText === undefined
            ? {}
            : { otherText: selection.otherText }),
        });
      };
      const toggleUnknown = () => {
        if (
          locked ||
          (field.type !== "select" && field.type !== "multiSelect") ||
          !field.allowUnknown
        )
          return;
        context.update(
          component.value.path,
          answer && typeof answer === "object" && "unknown" in answer
            ? { optionIds: [] }
            : { unknown: true },
        );
      };
      const updateOther = (value: string) => {
        if (locked) return;
        if (value === "") {
          context.update(component.value.path, {
            optionIds:
              field.type === "select" ? [] : (selection?.optionIds ?? []),
          });
          return;
        }
        if (
          field.type === "multiSelect" &&
          selection?.otherText === undefined &&
          choiceCount >= maxChoices
        ) {
          context.report(`最多选择 ${maxChoices} 项`);
          return;
        }
        context.update(component.value.path, {
          optionIds:
            field.type === "select" ? [] : (selection?.optionIds ?? []),
          otherText: value,
        });
      };
      if (field.type === "select" || field.type === "multiSelect") {
        const unknown =
          !!answer && typeof answer === "object" && "unknown" in answer;
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
              {`${field.label}${field.required ? labels.required : labels.optional}`}
            </MessageText>
            <View className="artifact-options">
              {field.options.map((option) => {
                const selected = !!selection?.optionIds.includes(option.id);
                return (
                  <Button
                    key={option.id}
                    className={`control artifact-choice${selected ? " is-selected" : ""}`}
                    disabled={locked || undefined}
                    aria-pressed={selected}
                    onClick={() => selectOption(option.id)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </View>
            {field.allowUnknown && (
              <Button
                className={`control artifact-choice artifact-choice-unknown${unknown ? " is-selected" : ""}`}
                disabled={locked || undefined}
                aria-pressed={unknown}
                onClick={toggleUnknown}
              >
                {labels.unknownChoice}
              </Button>
            )}
            {field.allowOther && (
              <Input
                className="artifact-input artifact-other-input"
                value={selection?.otherText ?? ""}
                placeholder={labels.otherChoice}
                maxlength={1200}
                disabled={locked}
                adjustPosition={false}
                onFocus={() => focusField(`artifact_field_${fieldId}`)}
                onInput={(event: { detail: { value: string } }) =>
                  updateOther(event.detail.value)
                }
              />
            )}
          </View>
        );
      }
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
            {`${field.label}${field.required ? labels.required : labels.optional}`}
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
              onInput={(event: { detail: { value: string } }) =>
                update(event.detail.value)
              }
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
              onInput={(event: { detail: { value: string } }) =>
                update(event.detail.value)
              }
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
            onClick={() => void submit(dispatch, component.action)}
          >
            {submitted
              ? labels.submitted
              : sending
                ? labels.submitting
                : child(component.child)}
          </Button>
          <MessageText className="artifact-caption">
            {submitted ? labels.submittedNote : labels.submitNote}
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
  const { Text: MessageText, openPage } = useArtifactUi();
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
          {section.items?.map((item, itemIndex) => (
            <MessageText
              aiGenerated
              external={external}
              key={itemIndex}
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
          onClick={() => openPage(component.url)}
        >
          打开独立页面 ↗
        </Button>
      )}
    </View>
  );
}

function CopyControl({
  value,
  label,
  external,
  copyText,
  notify,
  renderIcon,
  copied,
  failed,
}: {
  value: string;
  label: string;
  external: boolean;
  copyText(value: string, external: boolean): Promise<void>;
  notify(message: string): void;
  renderIcon: ReturnType<typeof useArtifactUi>["renderIcon"];
  copied: string;
  failed: string;
}) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  const actionLabel = state === "copied" ? copied : state === "failed" ? failed : label;
  return (
    <Button
      className="control message-action message-copy artifact-code-copy"
      aria-label={actionLabel}
      onLongPress={() => notify(actionLabel)}
      onClick={async () => {
        try {
          await copyText(value, external);
          setState("copied");
        } catch {
          setState("failed");
          notify(failed);
        }
      }}
    >
      {renderIcon(state === "copied" ? "check" : "copy")}
    </Button>
  );
}

export function tableCellText(value: string | number | boolean | null) {
  if (value === null) return "—";
  if (value === true) return "是";
  if (value === false) return "否";
  return String(value);
}
