import type { PropsWithChildren } from "react";
import { configureWeappValidation } from "@cfp/kith-inn-contracts/runtime";
import "./app.css";

// WeChat disables dynamic Function bodies; configure before page schemas load.
if (process.env.TARO_ENV === "weapp") configureWeappValidation();

export default function App({ children }: PropsWithChildren) { return children; }
