import config from "@payload-config";
import "@payloadcms/next/css";
import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts";
import type { ServerFunctionClient } from "payload";
import { importMap } from "./admin/importMap";
export default function Layout({ children }: { children: React.ReactNode }) {
  const serverFunction: ServerFunctionClient = async (args) => {
    "use server";
    return handleServerFunctions({ ...args, config, importMap });
  };
  return RootLayout({ children, config, importMap, serverFunction });
}
