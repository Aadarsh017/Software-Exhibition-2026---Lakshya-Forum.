# Sending sign-in emails from your own domain

> **Update (2026-10-19, later): APPLIED.** Resend is the sender and the three branded emails are live on project `xmcdubzdbmytlubfftzy` (`config diff` shows 0 differences); `NEXT_PUBLIC_EMAIL_CODE=true` shows the code boxes on the login page. To change the key, re-run `scripts/apply-email-settings.sh`. Still to check: the look of the email in a real inbox, and spike S6 (Gmail, Outlook, Yahoo, an Indian provider).
>
> *Earlier status, kept for the history:* **configured in `supabase/config.toml`, waiting to be applied.** Provider: **Resend**. Domain: **thedrawingboard.tech** (verified in Resend, sending enabled, region ap-northeast-1). Sender: `no-reply@thedrawingboard.tech`. The Resend SMTP login was checked on ports 465 and 587 without sending anything. The settings reach Supabase in step 4 of `scripts/connect-supabase.sh`, which asks for the Resend key with hidden input.

## Why this is needed

Supabase's built-in email sender is for trying things out. From Supabase's own documentation (checked 2026-10-19):

- It **only delivers to people on your Supabase project team**. Any other address fails with "Email address not authorized".
- It is limited to **2 emails per hour**, and Supabase says that can change without notice.
- It is "best effort", with no delivery promise, and is meant for non-production use.
- On new free projects the sign-in **email template cannot be restyled** while the built-in sender is in use.

Your domain does not change this: the built-in sender cannot send as your domain. Your domain is used by a **custom sender** (an email provider), which then sends as, for example, `no-reply@auth.yourdomain.com`.

## What works today, before any setup

You are on the project team, so the built-in sender **can email you**. That is enough to test sign-in yourself right now. You will receive Supabase's standard email with a **link** (not the 6-digit code), and the login page then asks you to open the link instead of showing code boxes. (Supabase refuses template changes on the built-in sender, checked 2026-10-19: HTTP 400.) The app handles the link: open it in the same browser where you asked for it. After step 7, set `NEXT_PUBLIC_EMAIL_CODE=true` in `apps/web/.env.local` to show the code boxes. Nobody else can sign in by email until you finish the steps below. Guest mode does not need email at all.

## Setup, once (about 20 minutes plus waiting for DNS)

1. **Pick a provider.** Supabase lists Resend, Amazon SES, Postmark, SendGrid, ZeptoMail and Brevo. **Resend is the easiest start.** Its free plan (from its pricing page, 2026-10-19) allows 3,000 emails a month and **100 a day**, 3 domains, and includes SMTP. Its first paid plan is $20 a month for 50,000 emails with no daily cap. The 100-a-day cap matters only if many people sign up by email in one day (guests need no email).
2. **Use a subdomain for sign-in mail**, such as `auth.yourdomain.com`. Supabase recommends keeping sign-in email on its own domain, so a mistake never harms your main domain's reputation.
3. **Add the domain in the provider** and copy the DNS records it shows (SPF and DKIM, sometimes a bounce record) into wherever your domain's DNS is managed. Wait until the provider says **Verified**.
4. **Create a sending-only credential** in the provider (for Resend, an API key with "sending access"). Keep it to yourself.
5. **Turn on custom SMTP in Supabase.** Dashboard, Authentication, find the SMTP settings (the labels move around, so search for "SMTP"). Enter:
   - Sender email: `no-reply@auth.yourdomain.com`, sender name: `Hale`
   - Host, port, user, password from your provider. For Resend these are `smtp.resend.com`, port `465` or `587`, user `resend`, and the API key as the password. **Confirm these on Resend's own SMTP page**; I wrote them from memory.
   - **Type the password into the dashboard yourself. Do not put it in any file in this repository.**
6. **Raise the sending limit.** After you save, Supabase starts with **30 emails per hour** to protect the new sender's reputation. Raise it under Authentication, Rate Limits when you are ready.
7. **Turn on the branded emails.** In `supabase/config.toml`, remove the `#` from the three `[auth.email.template.*]` blocks, then run `npx supabase config push` and read the difference it shows before saying yes. Order matters: do this **after** step 5, because templates cannot be changed on the built-in sender.
8. **Add a DMARC record** (a TXT record on `_dmarc.auth.yourdomain.com`), starting relaxed: `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`. Tighten it after a few weeks of clean reports.
9. **Tell the app where it lives.** When you have a production address, set Supabase's Site URL to it and list the exact callback in the redirect allow-list (`https://yourdomain.com/auth/callback`), replacing the local `**` entry for production.

## How to know it works (spike S6)

Send sign-in codes to Gmail, Outlook, Yahoo and one Indian provider. For each: it lands in the **inbox, not spam**, within about 30 seconds, and the message headers show SPF and DKIM passing. Do this before inviting anyone.

## About the emails themselves

`scripts/build-email-templates.mjs` builds three emails (sign-in, first sign-up, adding an email to a guest account) in the product's look: cream page, outlined card, the code large, a coral button as a fallback link, the emergency line in the footer. They use no images, fonts or tracking. The code lasts **15 minutes** (`otp_expiry = 900` in `config.toml`); if you change one, change the other. `npm test` checks them.
