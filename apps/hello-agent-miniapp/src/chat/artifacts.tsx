import { useMemo } from "react";
import { Text } from "@tarojs/components";
import {
  artifactsSchema,
  toA2ui,
  validateA2uiMessages,
  type A2uiMessage,
  type FormValues,
} from "@cfp/hello-agent-protocol";
import { ArtifactState, type ArtifactProps } from "./artifact-components";
import { A2uiHost } from "./a2ui-host";

const emptyResponses: Record<string, FormValues> = {};
export function LiveArtifacts({ messages }: { messages: A2uiMessage[] }) {
  return (
    <ArtifactSurfaces messages={messages} responses={emptyResponses} disabled />
  );
}
function ArtifactSurfaces({
  messages,
  responses,
  ...props
}: ArtifactProps & {
  messages: A2uiMessage[];
  responses: Record<string, FormValues>;
}) {
  // Reject unsupported components, unsafe paths and cycles before either renderer.
  const validated = useMemo(() => {
    try {
      return validateA2uiMessages(messages);
    } catch {
      return undefined;
    }
  }, [messages]);
  if (!validated)
    return (
      <Text className="artifact-error">作品格式暂不支持，文字回复仍可阅读</Text>
    );
  return (
    <A2uiHost
      messages={validated}
      renderSurface={(surface, content) => (
        <ArtifactState
          key={surface.id}
          surface={surface}
          {...props}
          submitted={!!responses[surface.id]}
          initialValues={responses[surface.id]}
        >
          {content}
        </ArtifactState>
      )}
    />
  );
}
export function Artifacts({
  turnId,
  artifacts,
  ...props
}: ArtifactProps & {
  turnId: number;
  artifacts: unknown;
  responses: Record<string, FormValues>;
}) {
  const messages = useMemo(() => {
    const result = artifactsSchema.safeParse(artifacts ?? [], {
      jitless: true,
    });
    return result.success ? toA2ui(turnId, result.data) : undefined;
  }, [turnId, artifacts]);
  if (!messages)
    return (
      <Text className="artifact-error">作品格式暂不支持，文字回复仍可阅读</Text>
    );
  return <ArtifactSurfaces messages={messages} {...props} />;
}
