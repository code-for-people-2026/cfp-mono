import configPromise from "@payload-config";
import { RootPage } from "@payloadcms/next/views";
import type { Metadata } from "next";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { importMap } from "../importMap";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const metadata: Metadata = {
  title: "码成工 Admin"
};

const Page = async ({ params, searchParams }: Args) => {
  try {
    return await RootPage({
      config: configPromise,
      importMap,
      params,
      searchParams
    });
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    return (
      <main className="mx-auto min-h-screen max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Payload admin init required</h1>
        <p className="mt-4 text-sm text-neutral-600">
          Ensure PostgreSQL is running and set{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
            PAYLOAD_DB_PUSH=true
          </code>{" "}
          for the first local or preview boot.
        </p>
      </main>
    );
  }
};

export default Page;

