# Study Room Booking App - Mini Project 2

UI follows the provided Meeting Room / Study Room Booking reference.

## Run
1. Install Node.js LTS and VS Code.
2. Open this folder in VS Code.
3. Run:
   npm install
   npx expo start

Then press:
- `a` for Android emulator
- `i` for iOS simulator (macOS)
- scan the QR code with Expo Go

## Accounts and Supabase setup
Authentication uses Supabase Auth. Supabase stores account credentials and the user's name metadata; passwords are never stored in this app. To connect a project:

1. Create a project at [supabase.com](https://supabase.com) and copy its Project URL and publishable key from **Project Settings > API**.
2. Create or update `.env` and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to those values. The publishable/anon key is intended for client apps; never put a `service_role` key in the app.
3. In Supabase **Authentication > URL Configuration**, allow `studyroombooking://auth/callback` and your local web URL (`http://localhost:8081/**`). Add your production app/site URLs before release.
4. Enable Email in **Authentication > Providers**. Email/password sign-up uses the confirmation email; one-time-code sign-in uses the email OTP template.
5. For Google sign-in, create a Google OAuth web client in Google Cloud Console. Set its authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`, then enable Google in Supabase and paste the OAuth client ID and secret there. Keep the secret in Supabase, never in this app.
6. Restart Expo after changing `.env` with `npx expo start --clear`.

The app includes Sign In, Sign Up, email OTP, password recovery, and Google OAuth screens. Google requires the provider setup above before it can authenticate.

## Deploy booking database
Run the SQL migration before using room booking:

1. Open the project's **SQL Editor** in Supabase Dashboard.
2. Open [supabase/migrations/202610020001_booking_reservations.sql](supabase/migrations/202610020001_booking_reservations.sql), paste the full script into a new query, and run it once.
3. Confirm `booking_rooms`, `bookings`, and `booking_resources` exist, along with the `hold_booking_resources`, `get_room_availability`, `submit_booking_transfer`, and `cancel_booking_hold` functions.
4. Reload the app. Room names, capacity, amenities, and hourly rates load from `booking_rooms`; photos remain bundled and are matched by room ID.
5. To enable per-user saved spaces, run [supabase/migrations/202610050001_user_favorites.sql](supabase/migrations/202610050001_user_favorites.sql) in SQL Editor after the booking migration. It creates `user_favorites` with row-level security so each signed-in user can only read and change their own favorites.

The hold RPC inserts the booking and all requested resources in one transaction. A PostgreSQL GiST exclusion constraint rejects overlapping time ranges for the same room/seat. Changing a selection atomically replaces the previous temporary hold. Holds expire after 15 minutes and are cleaned when a new hold or availability request runs. The app subscribes to `booking_resources` for availability and `bookings` for status changes; the database constraint is the final duplicate-booking protection.

Users can read their own booking records but cannot write reservation tables directly. The app can submit a transfer for review, but it cannot mark a payment confirmed. After verifying a bank transfer, an administrator must confirm/cancel both the booking and its resources through a trusted admin workflow. Do not expose a service-role key in the app. Automated verification requires a trusted payment webhook/server.

For this prototype only, an administrator can confirm a verified transfer in Supabase SQL Editor using its displayed transfer reference:

```sql
begin;
with target as (
   update public.bookings
   set status = 'confirmed'
   where payment_reference = 'TRANSFER_REFERENCE'
      and status = 'awaiting_verification'
   returning id
)
update public.booking_resources
set status = 'confirmed', hold_expires_at = null
where booking_id in (select id from target)
   and status = 'awaiting_verification';
commit;
```

Only run this after checking the actual bank transaction. For a real launch, replace manual SQL with an authenticated admin workflow or verified bank/payment webhook.

## Room booking and VietinBank QR
Add your VietinBank details to the existing `.env` file. Do not send account details in chat or commit `.env`:

```env
EXPO_PUBLIC_VIETQR_BANK_ID=970415
EXPO_PUBLIC_VIETQR_ACCOUNT_NUMBER=your_account_number
EXPO_PUBLIC_VIETQR_ACCOUNT_NAME=YOUR ACCOUNT NAME
```

The app creates a VietQR image for the booking amount and transfer reference. The image is requested from `img.vietqr.io`, so the account number, amount, and transfer note are sent to that image service. A transfer is not verified by the app or by a VietinBank API; submitting it creates an **Awaiting verification** record in Supabase and keeps the resources unavailable until an administrator confirms or cancels it.

Meeting rooms are booked as a whole room (10, 20, or 40 people). Library and study spaces are booked by seat. Seeded room prices are sample VND/hour rates; update the migration seed or `booking_rooms` rows to your actual rates. The Classes tab also contains example sessions and local-only demo registration; replace them with your real class schedule.

## Main requirements covered
- React Native + Expo Managed
- TypeScript
- React Navigation 7: typed Stack + Bottom Tabs
- Zustand: user-scoped persisted booking cache; temporary holds stay in memory
- TanStack Query: Supabase room catalog with pull-to-refresh
- Safe area context
- FlatList room feed with `FadeInDown` card animations
- Search + filter chips
- Room detail
- Date/time-slot booking
- Per-seat selection with available, held, and booked states
- Fifteen-minute temporary room/seat holds and database conflict prevention
- Availability counts for each room/date/time slot
- Per-user saved rooms with animated favorite controls
- My Bookings
- Profile

## Booking data
Room catalog and booking/payment records are stored in Supabase Postgres. Reservations are keyed by room, resource ID, and overlapping time range. Zustand only caches data for rendering and is not the source of truth. Temporary holds expire after 15 minutes. Payment submissions remain pending until independently verified. Class sessions and registrations remain sample local state.
