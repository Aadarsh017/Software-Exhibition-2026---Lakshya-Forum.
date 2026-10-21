import Link from "next/link";
import { isSignedInMember } from "@/lib/auth/member";

export async function SiteFooter() {
  const member = await isSignedInMember();
  return (
    <footer className="bg-[#1A1C1E] py-12 text-[#F7F3EB]">
      <div className="wrap wrap-wide">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-display text-[1.75rem] font-extrabold">hale</p>
            <p className="mt-1 opacity-90">health, explained calmly</p>
            <p className="mt-3 max-w-[46em] text-[0.9375rem] opacity-90">
              Not a doctor. Not for emergencies: call 112 (India) · 108 ambulance. Not affiliated with or endorsed by NIH,
              FDA or any agency named here.
            </p>
          </div>
        </div>
        <p className="mt-6 text-[0.875rem] opacity-80">
          <Link href="/emergency" className="text-[#F7F3EB]">
            Emergency numbers
          </Link>
          {" · "}
          {member ? (
            <Link href="/app" className="text-[#F7F3EB]">
              My chats
            </Link>
          ) : (
            <Link href="/login" className="text-[#F7F3EB]">
              Log in
            </Link>
          )}
        </p>
      </div>
    </footer>
  );
}
