// NutUI component CSS is imported INSIDE the `base` layer from app.css (via
// `@import "..." layer(base)`) — that way NutUI's rules sit below our `utilities`
// layer and our --nutui-* var overrides (also in base, later source order) win.
import "./app.css";

export default function App({ children }: { children: React.ReactNode }) {
  return children;
}
