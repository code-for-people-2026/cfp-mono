import { Button } from "@cfp/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#2f855a]">
            Code for People
          </p>
          <h1 className="text-4xl font-bold leading-tight text-neutral-950 md:text-6xl">
            码成工
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-neutral-700">
            一个为工友敲键盘的组织。第一版站点先跑通官网、Payload CMS 后台和小程序共用 API。
          </p>
        </header>

        <div className="flex flex-wrap gap-3">
          <Button>码上为民</Button>
          <a
            className="inline-flex h-10 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium"
            href="/admin"
          >
            Payload Admin
          </a>
        </div>
      </section>
    </main>
  );
}
