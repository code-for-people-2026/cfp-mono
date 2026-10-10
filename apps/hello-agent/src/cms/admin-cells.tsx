import Image from "next/image";
import Link from "next/link";
import type {
  BeforeListTableServerProps,
  DefaultServerCellComponentProps,
} from "payload";
import {
  executionSummary,
  inputSummary,
  recommendedColumnsURL,
} from "./presentation";

type CellProps = DefaultServerCellComponentProps;
function href(props: CellProps) {
  return (
    props.linkURL ||
    `${props.payload.config.routes.admin}/collections/${props.collectionSlug}/${encodeURIComponent(String(props.rowData.id))}`
  );
}
function Summary({ props, text }: { props: CellProps; text: string }) {
  return (
    <Link
      href={href(props)}
      title={text}
      style={{
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        width: 260,
        lineHeight: 1.6,
        textDecoration: "none",
      }}
    >
      {text}
    </Link>
  );
}
export function InputCell(props: CellProps) {
  return <Summary props={props} text={inputSummary(props.cellData)} />;
}
export function GreetingCell(props: CellProps) {
  return (
    <Summary
      props={props}
      text={
        typeof props.cellData === "string" && props.cellData
          ? props.cellData
          : props.rowData.status === "failed"
            ? "生成失败 · 查看原因"
            : "尚未生成"
      }
    />
  );
}
export function ExecutionCell(props: CellProps) {
  return <Summary props={props} text={executionSummary(props.cellData)} />;
}
export function MediaCell(props: CellProps) {
  const mime = String(props.cellData);
  const valid = /^image\/(jpeg|png|webp)$/.test(mime);
  // 使用管理员会话读取，不能交给公开图片优化代理，也不暴露 OSS 签名地址。
  return (
    <Link
      href={href(props)}
      style={{ display: "flex", alignItems: "center", gap: 12 }}
    >
      {valid && (
        <Image
          src={`/api/hello-admin/media/${props.rowData.id}`}
          width={64}
          height={64}
          unoptimized
          alt={`灵感图片 ${props.rowData.id}`}
          style={{ objectFit: "cover", borderRadius: 6 }}
        />
      )}
      <span>{mime}</span>
    </Link>
  );
}
export function RecommendedColumns({
  collectionSlug,
  payload,
}: BeforeListTableServerProps) {
  const url = recommendedColumnsURL(
    collectionSlug,
    payload.config.routes.admin,
  );
  if (!url) return null;
  return (
    <div
      style={{
        marginBottom: 16,
        fontSize: 13,
        color: "var(--theme-elevation-600)",
      }}
    >
      {/* 完整导航会重新初始化 Payload 的列状态，避免当前列表覆盖新的查询参数。 */}
      <a href={url}>使用推荐列</a>
      <span>
        {" "}
        ·
        按用途查看内容；会替换当前账号在本列表保存的列与排序，不修改任何业务数据。
      </span>
    </div>
  );
}
