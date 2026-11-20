declare const BUBU_API_ORIGIN: string;
declare const BUBU_AUTH_MODE: "legacy" | "sidecar";

declare const BUBU_WECHAT_SI_ENABLED: boolean;

declare module "*.png" { const path: string; export default path; }
