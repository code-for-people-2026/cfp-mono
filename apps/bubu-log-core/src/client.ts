import { getPayload } from "payload";
import config from "../payload.config";
export const getCore = () => getPayload({ config });
