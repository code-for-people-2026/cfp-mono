import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, experimental: { cpus: 1 }, typescript: { ignoreBuildErrors: process.env.BUBU_BUILD_TYPES_VERIFIED === "true" } };
export default withPayload(config);
