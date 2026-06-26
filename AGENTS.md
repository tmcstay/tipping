\# Tipping Suite — Master Build Spec



\## 1. Product Vision



Build a suite of tipping apps for different sports and events using one shared platform, one shared backend, one shared tipping engine and multiple branded app configurations.



The first app is \*\*F1Tips\*\*.



Future apps may include:



\* Supercars Tips

\* NASCAR Tips

\* IndyCar Tips

\* Tour de France Tips

\* Giro Tips

\* Vuelta Tips

\* General Pro Cycling Tips



The long-term goal is to create profitable iOS, Android and web apps using:



\* Free tier with ads

\* Paid subscription to remove ads

\* Optional future prizes

\* Community chat zones

\* Leaderboards

\* Private tipping groups

\* Configurable event and sport rules



The project must be built in a way that avoids duplicating logic for each sport.



\---



\## 2. Core Technology Stack



Use:



\* \*\*Expo React Native\*\* for iOS, Android and web

\* \*\*TypeScript\*\*

\* \*\*Supabase\*\* for backend, database, auth, storage, realtime and edge functions

\* \*\*Postgres\*\* as source of truth

\* \*\*RevenueCat\*\* for subscriptions and no-ads entitlement

\* \*\*Google AdMob\*\* for mobile ads

\* \*\*GitHub\*\* for version control

\* \*\*Codex\*\* as coding agent working against this repo



The architecture should support:



\* Multiple branded apps from one codebase

\* Shared backend

\* Shared user identity

\* Shared subscription entitlement where possible

\* Shared tipping and scoring logic

\* Sport-specific configuration



\---



\## 3. Key Architecture Rule



Do not build separate codebases for each tipping app.



Build a reusable platform where each app is controlled by configuration.



The core model is:



```text

app → sport → competition → season → event → market → tip → result → score → leaderboard

```



Examples:



```text

F1Tips → Motorsport → Formula 1 → 2026 → Australian GP → Race Winner → Verstappen → Result → Points

CyclingTips → Cycling → Tour de France → 2026 → Stage 5 → Stage Winner → Rider → Result → Points

```



The app should not hard-code F1-specific logic into the core tipping engine.



\---



\## 4. Repo Structure



Use this structure unless there is a strong reason to change it.



```text

tipping-suite/

&#x20; apps/

&#x20;   mobile/

&#x20;     app/

&#x20;     components/

&#x20;     screens/

&#x20;     config/

&#x20;       f1tips.ts

&#x20;       supercars.ts

&#x20;       nascar.ts

&#x20;       indycar.ts

&#x20;       cycling.ts

&#x20;     lib/

&#x20;     hooks/

&#x20;     navigation/

&#x20;     assets/



&#x20;   admin-web/

&#x20;     app/

&#x20;     components/

&#x20;     lib/



&#x20;   marketing-web/

&#x20;     app/

&#x20;     components/

&#x20;     content/



&#x20; packages/

&#x20;   tipping-core/

&#x20;     scoring/

&#x20;     locking/

&#x20;     leaderboards/

&#x20;     market-types/

&#x20;     validation/

&#x20;     dummy-data/



&#x20;   ui/

&#x20;     buttons/

&#x20;     cards/

&#x20;     forms/

&#x20;     layout/



&#x20;   supabase-client/

&#x20;     client.ts

&#x20;     auth.ts

&#x20;     queries.ts



&#x20;   shared-types/

&#x20;     database.ts

&#x20;     app-config.ts

&#x20;     tipping.ts



&#x20; supabase/

&#x20;   migrations/

&#x20;   seed/

&#x20;   functions/

&#x20;     calculate-leaderboard/

&#x20;     generate-dummy-tips/

&#x20;     publish-system-post/

&#x20;     revenuecat-webhook/

&#x20;     ad-campaign-scheduler/



&#x20; docs/

&#x20;   product-scope.md

&#x20;   schema.md

&#x20;   monetisation.md

&#x20;   moderation-policy.md

&#x20;   app-store-notes.md

&#x20;   codex-tasks.md



&#x20; AGENTS.md

&#x20; README.md

```



\---



\## 5. App Configuration



Each app variant should have a config file.



Example:



```ts

export const f1TipsConfig = {

&#x20; appKey: "f1tips",

&#x20; appName: "F1Tips",

&#x20; sportType: "motorsport",

&#x20; defaultCompetitionKey: "formula\_1",

&#x20; theme: {

&#x20;   primaryColor: "#E10600",

&#x20;   secondaryColor: "#111111",

&#x20;   backgroundColor: "#FFFFFF"

&#x20; },

&#x20; features: {

&#x20;   ads: true,

&#x20;   subscriptions: true,

&#x20;   chat: true,

&#x20;   dummyActivity: true,

&#x20;   prizes: false

&#x20; },

&#x20; marketTypes: \[

&#x20;   "race\_winner",

&#x20;   "podium",

&#x20;   "fastest\_lap",

&#x20;   "qualifying\_winner"

&#x20; ]

}

```



Future app variants should use the same structure.



Do not duplicate core screens unless unavoidable.



\---



\## 6. Initial Product Scope — F1Tips MVP



The first build is F1Tips.



MVP features:



\### User



\* Sign up

\* Log in

\* Log out

\* View profile

\* Select display name

\* View active F1 season

\* View list of races

\* View race detail

\* Submit tips before lock time

\* View own tips

\* View results after event completion

\* View leaderboard

\* View fan chat zone



\### Admin



\* Create/edit competition

\* Create/edit season

\* Create/edit events/races

\* Create/edit markets

\* Add competitors/drivers/constructors

\* Enter results

\* Trigger leaderboard recalculation

\* Generate dummy users

\* Generate dummy tips

\* Publish official chat posts

\* Publish sponsored chat posts

\* Moderate chat



\### Monetisation placeholders



\* Ads enabled for free users

\* Paid users have ads removed

\* RevenueCat entitlement placeholder: `no\_ads`

\* AdMob placement placeholders



\### Excluded from MVP



\* Real prizes

\* Paid competitions

\* Gambling

\* External spam bots

\* Complex live timing integrations

\* Real-money rewards

\* Multi-language support



\---



\## 7. Database Design



Use Supabase Postgres.



All exposed tables must use Row Level Security.



Use UUID primary keys unless there is a reason not to.



Use `created\_at`, `updated\_at` and appropriate audit fields.



\### Core Tables



```sql

apps

\- id uuid primary key

\- app\_key text unique not null

\- name text not null

\- sport\_type text not null

\- theme jsonb

\- ads\_enabled boolean default true

\- subscriptions\_enabled boolean default true

\- dummy\_activity\_enabled boolean default false

\- prizes\_enabled boolean default false

\- created\_at timestamptz default now()



profiles

\- id uuid primary key references auth.users(id)

\- display\_name text

\- avatar\_url text

\- is\_admin boolean default false

\- is\_dummy boolean default false

\- created\_at timestamptz default now()

\- updated\_at timestamptz



competitions

\- id uuid primary key

\- app\_id uuid references apps(id)

\- competition\_key text not null

\- name text not null

\- sport\_type text not null

\- created\_at timestamptz default now()



seasons

\- id uuid primary key

\- competition\_id uuid references competitions(id)

\- season\_year int not null

\- name text not null

\- status text not null default 'draft'

\- created\_at timestamptz default now()



events

\- id uuid primary key

\- season\_id uuid references seasons(id)

\- event\_key text not null

\- name text not null

\- venue text

\- country text

\- starts\_at timestamptz

\- lock\_at timestamptz

\- status text not null default 'scheduled'

\- created\_at timestamptz default now()



competitors

\- id uuid primary key

\- competition\_id uuid references competitions(id)

\- competitor\_key text not null

\- name text not null

\- competitor\_type text not null

\- team\_name text

\- active boolean default true

\- created\_at timestamptz default now()



markets

\- id uuid primary key

\- event\_id uuid references events(id)

\- market\_key text not null

\- market\_type text not null

\- name text not null

\- lock\_at timestamptz

\- points\_rule jsonb not null

\- status text not null default 'open'

\- created\_at timestamptz default now()



tips

\- id uuid primary key

\- user\_id uuid references profiles(id)

\- market\_id uuid references markets(id)

\- competitor\_id uuid references competitors(id)

\- submitted\_at timestamptz default now()

\- is\_dummy boolean default false

\- unique(user\_id, market\_id)



results

\- id uuid primary key

\- market\_id uuid references markets(id)

\- competitor\_id uuid references competitors(id)

\- position int

\- points\_awarded int

\- result\_status text default 'official'

\- created\_at timestamptz default now()



leaderboards

\- id uuid primary key

\- app\_id uuid references apps(id)

\- season\_id uuid references seasons(id)

\- user\_id uuid references profiles(id)

\- total\_points int default 0

\- rank int

\- tips\_count int default 0

\- updated\_at timestamptz default now()

\- unique(app\_id, season\_id, user\_id)



chat\_zones

\- id uuid primary key

\- app\_id uuid references apps(id)

\- competition\_id uuid references competitions(id)

\- season\_id uuid references seasons(id)

\- name text not null

\- created\_at timestamptz default now()



chat\_messages

\- id uuid primary key

\- chat\_zone\_id uuid references chat\_zones(id)

\- user\_id uuid references profiles(id)

\- body text not null

\- is\_system boolean default false

\- is\_sponsored boolean default false

\- is\_dummy boolean default false

\- moderation\_status text default 'visible'

\- created\_at timestamptz default now()



subscriptions

\- id uuid primary key

\- user\_id uuid references profiles(id)

\- provider text not null

\- provider\_customer\_id text

\- entitlement text not null

\- status text not null

\- current\_period\_end timestamptz

\- created\_at timestamptz default now()

\- updated\_at timestamptz



ad\_placements

\- id uuid primary key

\- app\_id uuid references apps(id)

\- placement\_key text not null

\- provider text not null

\- active boolean default true

\- config jsonb

\- created\_at timestamptz default now()



system\_posts

\- id uuid primary key

\- app\_id uuid references apps(id)

\- chat\_zone\_id uuid references chat\_zones(id)

\- post\_type text not null

\- title text

\- body text not null

\- is\_sponsored boolean default false

\- scheduled\_at timestamptz

\- published\_at timestamptz

\- created\_at timestamptz default now()

```



\---



\## 8. RLS Rules



Implement Row Level Security carefully.



General principles:



\* Users can read public competition, season, event, competitor, market and leaderboard data.

\* Users can only insert or update their own tips.

\* Tips cannot be inserted or changed after the relevant market/event lock time.

\* Users can read their own profile.

\* Users can update limited fields on their own profile.

\* Admins can manage competitions, events, markets, competitors, results, chat moderation and system posts.

\* Public users can read visible chat messages.

\* Authenticated users can post chat messages.

\* Moderated, hidden or deleted messages should not appear to normal users.

\* Dummy users and dummy tips must be marked clearly in the database.



Avoid using user-editable metadata for authorisation.



Do not expose service role keys to the app.



\---



\## 9. Tipping Logic



Users submit tips against markets.



Each market has:



\* event

\* market type

\* lock time

\* points rule

\* status



A user may have only one tip per market.



Tips can be changed before lock time.



Tips become read-only after lock time.



A market can be manually locked by admin.



Scoring should be implemented in shared `packages/tipping-core`.



Initial scoring rules:



```ts

race\_winner:

&#x20; correct = 10 points

&#x20; incorrect = 0 points



podium:

&#x20; correct driver in podium = 5 points

&#x20; exact position = 10 points



fastest\_lap:

&#x20; correct = 5 points



qualifying\_winner:

&#x20; correct = 5 points

```



Cycling scoring can be added later using the same model.



\---



\## 10. Dummy Users and Dummy Tips



Dummy users are allowed for:



\* Demo data

\* Testing

\* Load simulation

\* Pre-launch seed data

\* Admin preview



Dummy users must always be marked:



```text

profiles.is\_dummy = true

tips.is\_dummy = true

chat\_messages.is\_dummy = true

```



The app must never misrepresent dummy users as real people.



Admin should be able to:



\* Generate dummy users

\* Generate dummy tips

\* Clear dummy users

\* Hide/show dummy leaderboard data

\* Hide/show dummy chat messages



For public launch, dummy activity must either be hidden or clearly labelled as demo/sample activity.



\---



\## 11. Chat and Growth Agent



Build a safe internal content agent called:



```text

Community Growth Agent

```



The agent may:



\* Draft official posts

\* Publish official app posts

\* Publish sponsored posts clearly labelled as sponsored

\* Publish race reminders

\* Publish tipping deadline reminders

\* Publish leaderboard summaries

\* Publish result recaps

\* Suggest external social media posts for manual review



The agent must not:



\* Pretend to be a real fan

\* Create fake testimonials

\* Spam external communities

\* Evade moderation

\* Post misleading messages

\* Create deceptive fake activity



All agent posts must use one of these labels:



```text

Official

Sponsored

System

Race Reminder

Leaderboard Bot

Result Recap

```



Chat must include:



\* Reporting

\* Blocking/muting if practical

\* Admin moderation

\* Hidden/deleted message states

\* Basic profanity/abuse filtering

\* Terms and moderation policy



\---



\## 12. Ads



Ads are enabled for free users.



Paid users with entitlement `no\_ads` should not see ads.



Initial ad placements:



```text

home\_banner

event\_detail\_banner

leaderboard\_native

post\_tip\_interstitial

chat\_feed\_native

```



Ad logic should be abstracted so that AdMob can be added later without rewriting screens.



Use an `AdSlot` component.



Example:



```tsx

<AdSlot placementKey="home\_banner" />

```



The `AdSlot` component should:



\* Check app config

\* Check subscription entitlement

\* Check placement active status

\* Render placeholder in development

\* Render real AdMob unit in production later



\---



\## 13. Subscriptions



Use RevenueCat later.



For now, build an entitlement abstraction.



Initial entitlement:



```text

no\_ads

```



Create a hook:



```ts

useEntitlements()

```



It should return:



```ts

{

&#x20; loading: boolean

&#x20; noAds: boolean

&#x20; entitlements: string\[]

}

```



Initially this can read from Supabase `subscriptions`.



Later it can connect to RevenueCat.



\---



\## 14. Admin Web Console



The admin console is required early.



Admin functions:



\* Manage apps

\* Manage competitions

\* Manage seasons

\* Manage events

\* Manage markets

\* Manage competitors

\* Enter results

\* Recalculate leaderboards

\* Generate dummy users

\* Generate dummy tips

\* Manage chat zones

\* Moderate chat

\* Publish official posts

\* Publish sponsored posts

\* View basic metrics



Admin must be protected.



Normal users must not access admin routes.



\---



\## 15. Web Presence



Each app needs a web presence.



Minimum pages:



\* Home

\* How it works

\* Leaderboard preview

\* Download app

\* Privacy policy

\* Terms

\* Contact

\* Account deletion instructions



Future:



\* Public event pages

\* Public leaderboards

\* SEO pages for each competition

\* Blog/news/recap pages



\---



\## 16. Coding Standards



Use TypeScript.



Use clear folder structure.



Avoid duplicated logic.



Core tipping logic should be tested.



Do not hard-code F1 rules directly into screens.



Use app config and market types.



Use Supabase types where possible.



Use environment variables for keys.



Never commit secrets.



Add helpful comments where business logic is non-obvious.



Use small, reviewable commits.



\---



\## 17. Testing



Add tests for:



\* Event lock logic

\* Market lock logic

\* Tip creation

\* Tip update before lock

\* Tip update rejected after lock

\* Scoring race winner

\* Scoring podium

\* Leaderboard calculation

\* Dummy tip generation

\* No-ads entitlement check

\* RLS policies where practical



\---



\## 18. First Build Target



The first build target is:



```text

F1Tips MVP

```



It must include:



\* Expo app shell

\* Supabase client

\* Auth

\* App config

\* F1 season seed data

\* Race list screen

\* Race detail screen

\* Tip submission

\* Lock time handling

\* Results entry placeholder

\* Leaderboard screen

\* Dummy users/tips generator

\* AdSlot placeholder

\* No-ads entitlement placeholder

\* Basic chat zone

\* Admin web foundation



\---



\## 19. Codex Operating Instructions



When implementing, do not rewrite the whole project unless explicitly asked.



Work one feature at a time.



Before changing code:



1\. Inspect the existing structure.

2\. Identify the smallest safe change.

3\. Implement the change.

4\. Add or update tests.

5\. Explain what changed.

6\. Mention any assumptions.



Avoid broad refactors unless requested.



Do not introduce new major dependencies without explaining why.



Do not remove existing features unless requested.



Do not bypass Supabase RLS by using service role keys in client code.



Do not invent legal/compliance behaviour for prizes. Prizes are a future feature and should remain disabled in MVP.



\---



\## 20. Immediate Priority



Start with:



1\. Create Expo app structure

2\. Create shared packages

3\. Create Supabase schema migration

4\. Add seed data for F1Tips

5\. Add auth

6\. Add race list

7\. Add race detail

8\. Add tipping

9\. Add scoring

10\. Add leaderboard



