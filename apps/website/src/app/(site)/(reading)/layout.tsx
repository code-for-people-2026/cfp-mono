import { RouteSiteShell } from "@/components/site";
import { SiteFooter } from "../shared/site-footer";

export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return <RouteSiteShell fullFooter={<SiteFooter />}>{children}</RouteSiteShell>;
}
