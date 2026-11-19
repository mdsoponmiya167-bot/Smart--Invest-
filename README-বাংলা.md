# Smart Invest — Backend Starter (Sandbox)

এটি একটি server-backed starter: registration/login, PostgreSQL, admin view, SSLCOMMERZ hosted checkout session, IPN এবং server-side validation আছে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা
- **এটি sandbox-only**। `SSL_MODE` অবশ্যই `sandbox`; অন্য মান দিলে সার্ভার চালু হবে না।
- এটি বাস্তব বিনিয়োগ/জনসাধারণের টাকা সংগ্রহের জন্য অনুমোদিত বা প্রস্তুত বলে দাবি করে না।
- ডেমো সফল পেমেন্টও বিনিয়োগ ব্যালেন্সে যোগ করে না (`ENABLE_WALLET_CREDIT=false`)।
- SSLCOMMERZ-কে আপনার ব্যবসার প্রকৃতি (investment/fund collection) লিখিতভাবে জানিয়ে সেই নির্দিষ্ট ব্যবহারের অনুমতি নিন। Gateway-এর সাধারণ merchant approval মানেই investment deposits অনুমোদিত নয়।
- বাস্তব চালুর আগে বাংলাদেশের প্রযোজ্য লাইসেন্স/নিয়ন্ত্রক অনুমোদন, AML/KYC, গ্রাহক সুরক্ষা, refund/dispute, হিসাব ও আইনজীবীর পর্যালোচনা লাগবে।
- production hardening, security audit, privacy policy, terms, backup/monitoring ও penetration test ছাড়া লাইভে ব্যবহার করবেন না।

## লোকাল চালানোর নিয়ম
1. Node.js 20+ এবং PostgreSQL ইনস্টল করুন।
2. এই ফোল্ডারে `.env.example` কপি করে `.env` নাম দিন।
3. PostgreSQL-এ `smartinvest` নামে database বানান।
4. `.env`-এ `DATABASE_URL`, `SESSION_SECRET` (কমপক্ষে ৩২ অক্ষর), admin email/password বসান।
5. SSLCOMMERZ sandbox account খুলে Store ID ও Store Password বসান:
   https://developer.sslcommerz.com/registration/
6. `npm install` তারপর `npm start`।
7. `http://localhost:3000` খুলুন।
8. Sandbox merchant panel-এ IPN URL সেট করুন: `https://YOUR_PUBLIC_DOMAIN/api/payment/ipn` (localhost public নয়; tunnel/public staging URL লাগবে)।

## Render-এ deploy
1. GitHub-এ এই project upload করুন।
2. Render-এ New → Blueprint থেকে `render.yaml` deploy করুন।
3. Environment Variables-এ `BASE_URL` দিন (Render-এর https URL), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` দিন।
4. Render PostgreSQL connection `DATABASE_URL` auto-bind হবে।
5. প্রথমে sandbox credentials-এই পরীক্ষা করুন।
6. SSLCOMMERZ panel-এ IPN URL সেট করুন।
7. Live mode এই starter-এ ইচ্ছাকৃতভাবে বন্ধ। লাইভের আগে provider-এর লিখিত অনুমোদন ও পৃথক security/compliance review আবশ্যক।

## API
- `POST /api/register` — `{name,email,password}`
- `POST /api/login` — `{email,password}`
- `POST /api/logout`
- `GET /api/me`
- `POST /api/deposits` — `{amount}` (authenticated; sandbox only)
- `POST /api/payment/ipn` — gateway notification; validates against SSLCOMMERZ validation API
- `GET /api/admin/deposits` — admin only
- `GET /api/admin/users` — admin only

## Gateway references
SSLCOMMERZ hosted checkout uses server-side session creation, IPN, and Order Validation API. The server compares transaction ID, BDT currency, amount and risk level before marking a payment `verified_sandbox`.
