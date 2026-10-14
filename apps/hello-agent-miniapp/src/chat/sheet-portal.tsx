import type { ReactNode } from "react";
import { RootPortal } from "@tarojs/components";

export function SheetPortal({ children }: { children: ReactNode }) {
  return <RootPortal>{children}</RootPortal>;
}
