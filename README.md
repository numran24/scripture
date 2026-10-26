# Scripture

A phone-first, installable web app (PWA) for daily reading, memorizing and review. One user, English, no frameworks, no build step, no dependencies. It works fully offline; syncing across devices is optional.

## Run it locally

```
npm run serve        # then open http://localhost:8080
npm test             # logic tests (schedule, plan, streak, CSV import/diff)
```

On first launch choose **Load 20 sample verses** to try it, or **Import my verses**.

## Import your CSVs

**Verses** (`id, reference, handle, ring, group, starred, text, week, theme`)

1. Settings > Data > **Replace verse data** (the same screen is used for the first import).
2. Choose the CSV. Review the preview: added, updated, unchanged, missing from the file, errors (bad rows are skipped and listed with line numbers).
3. Pick a mode, then **Apply** and confirm.

Rules:
- Rows match existing verses by `id`, then by `reference`. The existing id is always kept, so memorized status, review schedule, streak, notes and plan position carry over. Only content fields change.
- **Update matching verses** (default) leaves verses that are not in the file alone. **Replace everything** also removes the missing ones, with an extra warning. (Their progress records are kept, and Undo brings them back.)
- Empty `text` in the file does not erase text you pasted in the app (checkbox, on by default).
- A column missing from the file leaves that field unchanged.
- `starred` accepts true/false (also yes/no, 1/0). `week` must be 1 to 12 or blank.
- A copy of your data is saved automatically before every import. **Undo last import** is on the Settings screen. Undo restores verse/thought content only; progress made since is kept.
- Settings shows which file is loaded and when.

**Lie-to-Truth** (`thought, truth_to_say, verse_references`): same screen from Settings, rows match by thought text (case and quote marks ignored). References are matched to verses by reference text; unknown references are reported as warnings.

Templates can be downloaded from Settings or `templates/`.

**Memorize passages.** The 36 plan passages (3 per week) are matched to your table by reference. Where the plan says a range your table splits into rows (for example `Eph 4:22-24` stored as 4:22, 4:23, 4:24), those rows are combined into one passage. With the TEMP file this applies to Eph 4:22-24, Eph 6:10-11, Col 3:12-13, Rom 12:1-2, 2 Cor 10:5 (inside the row 10:3-5) and 1 John 4:18-19 (rows 4:16-18 and 4:19). A passage whose verses have no text is flagged "needs text".

## How it behaves

- **Today:** Read (the day's slice of this week's entries), Memorize (the week's 3 passages plus anything you queued in the last 7 days), Review (due or overdue, oldest first, max 20), and a Meditate prompt.
- **Plan:** advances only when you mark a day's Read done. Reading days per week: 4 to 7. "Read another day" gives a make-up day.
- **Streak:** consecutive days with at least one Read done. One missed day per calendar week is forgiven if the next day has two Read days (the day plus a make-up).
- **Drill levels:** pick how to drill at the top of the drill screen. *Auto* steps a verse up one stage per Good (full text, first letters, fill-in 30%, fill-in 60%, reference only). Or choose any level yourself: you can also type the verse from memory, either with the first letters shown (*Write most*) or with nothing shown (*Write all*). After you check, your typing is compared word by word (capitals and punctuation ignored), missed words are underlined, and a grade is suggested. Tap an underlined word to count it as right (for a keyboard slip), or use **Forgive likely typos** to do it for words that are only a letter or two off; the score and suggestion update, and only the grade you press is recorded. You still grade yourself. A Good at a harder level than the verse's stage moves its stage up to that level. Missed goes back a stage, Hard stays. Cards alternate between the reference and a linked Lie-to-Truth thought.
- **Schedule:** steps 1, 3, 7, 14, 30, 60 days. Missed resets to 1 day, Hard repeats, Good moves up one step, Easy skips one. Daily for the first 7 days. Memorized once a Good (or Easy) reaches the 14-day step.

## Sync (optional): Supabase

Sync uses your own free Supabase project with email magic-link sign-in and last-write-wins per record. Without it, everything stays on the device.

1. Create a project at supabase.com.
2. SQL Editor, run:

```sql
create table public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,
  key  text not null,
  data jsonb,
  u bigint not null,              -- client edit time (last write wins)
  d boolean not null default false,
  s bigint not null default 0,    -- server stamp, used to pull changes
  primary key (user_id, kind, key)
);
create index records_s on public.records (user_id, s);
alter table public.records enable row level security;
create policy "own rows" on public.records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.records_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.u < old.u then return null; end if;  -- keep the newer write
  new.s := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;
create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();
```

3. Authentication > URL Configuration: set **Site URL** to your deployed app URL (and add it under Redirect URLs).
4. After you have signed in once, Authentication > Providers > Email: turn off **Allow new users to sign up** so nobody else can create an account.
5. Project Settings > API: copy the **Project URL** and **anon public** key. Either paste them into `js/config.js` before deploying, or enter them on the phone in Settings > Sync.
6. Settings > Sync: enter your email, tap the link in the email on the same device/browser, then **Sync now**. It also syncs on open, when you come back online, and a few seconds after changes.

The anon key is designed to be public; row-level security keeps your rows private. Clocks decide ties, so keep your devices' dates correct.

## Deploy (free static hosting)

It is just static files. Upload the folder contents as-is to any of:
- **Cloudflare Pages / Netlify:** drag the folder into the dashboard (no build command, output directory is the folder root).
- **GitHub Pages:** push the folder to a repo, Settings > Pages > deploy from the main branch. (Works from a sub-path; all links are relative.)

HTTPS is required for install, offline and notifications (all of the above provide it).

**Install:** iPhone, open in Safari, Share > Add to Home Screen. Android, Chrome menu > Install app.

**After you change any file**, bump `VERSION` in `sw.js` so installed copies update.

## Reminders

Settings > Daily reminder. Browsers cannot send true push notifications without a push server, which this app deliberately does not have, so:
- the reminder fires while the app is open or recently used;
- on Chrome for Android with the installed app, it can also fire in the background (periodic sync) when the browser allows it;
- on iPhone it works only after Add to Home Screen and permission is granted, and not in the background;
- where notifications are unavailable or blocked, Settings says so and a phone alarm is the fallback.

The reminder is skipped on days you already finished the Read part.

## Backup

Settings > Data: full backup (JSON, restorable on any device), plus verses, Lie-to-Truth and progress CSV exports. Restoring a backup saves a copy of the current data first so it can be undone.

## Files

```
index.html  styles.css  manifest.webmanifest  sw.js
js/logic.js   pure logic (schedule, plan, streak, hints, CSV, import diff), unit tested
js/db.js      local-first store (IndexedDB), backups
js/store.js   domain layer
js/sync.js    Supabase REST sync (no SDK)
js/app.js     screens
sample/  templates/  tests/
```
