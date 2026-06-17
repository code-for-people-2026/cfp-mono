import { SiteFooter } from "../shared/site-footer";

// Shared layout for the reading/marketing pages (home + the public documents).
// The chat route lives outside this group, so it intentionally has no footer.
export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
