declare const HELLO_API_ORIGIN: string;
declare const HELLO_WECHAT_SI_ENABLED: boolean;
declare module "*.png" {
  const source: string;
  export default source;
}
declare module "*.svg?raw" {
  const source: string;
  export default source;
}

declare const HELLO_BUILD_LABEL: string;

declare module "*.webp" {
  const source: string;
  export default source;
}
