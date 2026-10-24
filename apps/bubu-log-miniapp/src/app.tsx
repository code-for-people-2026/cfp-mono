import { clearPrivacyExports } from "./privacy/exports";
import { useEffect, type PropsWithChildren } from "react";
import "./app.css";

export default function App({ children }: PropsWithChildren) {
  useEffect(clearPrivacyExports, []);
  return children;
}
