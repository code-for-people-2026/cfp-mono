import configPromise from "@payload-config";
import { RootPage } from "@payloadcms/next/views";
import type { Metadata } from "next";
import { importMap } from "../importMap";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const metadata: Metadata = {
  title: "街坊味 Admin",
};

export default async function Page({ params, searchParams }: Args) {
  return RootPage({
    config: configPromise,
    importMap,
    params,
    searchParams,
  });
}
