import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <div className="min-screen-h flex flex-col">
      <SiteHeader accountAware={false} />
      {/* Centred in the space under the header (DESIGN.md 8.3, "Short pages sit in the middle"). */}
      <main id="main" className="wrap m-auto w-full py-10 text-center">
        <h1 className="display">We can&apos;t find that page</h1>
        <p className="lead mx-auto mt-4 max-w-[30em]">If you need help right now, call 112.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3.5">
          <Link href="/" className="btn btn-primary btn-lg">
            Go to the home page
          </Link>
          <Link href="/emergency" className="btn btn-lg">
            Emergency numbers
          </Link>
        </div>
      </main>
    </div>
  );
}
