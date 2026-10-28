# BunkIn integration contract

Part 2 was not provided. This is the proposed adapter contract implemented in `src/lib/api.ts`, not a claim that any of these endpoints exist. Change that module to match the actual backend without rewriting screens. All responses are direct JSON objects/arrays (not a `{data: ...}` envelope). Error responses should be `{message: string}` with a correct HTTP status.

## Public/read endpoints

| Method | Path | Response |
|---|---|---|
| GET | `/menu` | `Food[]` |
| GET | `/restaurant` | `Restaurant` |
| GET | `/offers` | `Coupon[]` |

Domain interfaces are in `src/lib/types.ts`. Prices are INR decimal numbers in this frontend; if Part 2 uses integer paise, convert **only in the adapter**, including requests and responses. Product image URLs must be HTTPS. Fixture image keys are preview-only. A dish must include at least one variant.

## Authenticated customer endpoints

Every request sends `Authorization: Bearer <Supabase access token>`. The client uses only a public Supabase anon key. Roles must be determined from server-owned records (Supabase `app_metadata` / the `profiles` table); the frontend never writes a role. Public sign-up must always produce a `customer`. Owner, manager and rider accounts exist only because the owner created them, and a disabled account must be refused on every endpoint.

| Method | Path | Payload/response |
|---|---|---|
| GET, PATCH | `/me` | `Profile` including `role` (`customer`, `owner`, `manager` or `rider`) and `mustChangePassword`; PATCH accepts name/phone, never role |
| POST | `/me/password-changed` | `{}` → updated `Profile`; clears `mustChangePassword` after the client changed the password through Supabase Auth |
| GET, POST | `/me/addresses` | `Address[]` / saved `Address` |
| GET | `/me/notifications` | `{id,title,body,read}[]` |
| GET | `/orders` | Authorized `Order[]` |
| GET | `/orders/:id` | Authorized `Order` (owner and assigned rider may also be allowed) |
| POST | `/checkout` | `CheckoutRequest` → `{order: Order, paymentUrl?: string}` |
| POST | `/orders/:id/cancel` | `{reason}` → updated `Order` |
| POST | `/orders/:id/review` | `{rating,comment}` → 2xx |
| POST | `/support` | `{subject,message}` → `{id}` |

Checkout sends food IDs, quantity, variant/add-on IDs, spice, item instructions, address, contact phone, delivery instructions, coupon, payment method and an idempotency key. The backend must validate stock, restaurant hours/holidays, delivery radius, minimums, options, customer identity and coupon eligibility; recompute all charges and persist atomically. Never trust client totals or a fixture product.

For online payment, return a validated HTTPS provider-hosted payment URL. The client opens it and continues to the server-created order. `pending` must remain pending until your webhook verifies settlement. A provider return URL is not payment proof. Payment/refund updates are read from the order endpoint. Keep idempotency keys durable on the server to protect against network retries.

Cancellation button is shown for `placed` orders. The server owns the final restaurant policy and must reject expired cancellation windows. OTPs must be verified server-side, rate-limited, bound to the assigned order and never included in customer-visible order JSON.

## Owner endpoints

Require an owner or manager role for the one restaurant on **every** endpoint, including GET. Managers get orders, menu, categories, riders and analytics reads. Settings, coupons, refunds, reports, customer/payment records and team management are **owner-only**.

- `GET /owner/analytics?period=daily|weekly|monthly` → `Analytics`.
- `GET /owner/orders` → `Order[]` with only authorized delivery coordinates.
- `PATCH /owner/orders/:id` → updated order. Body supports `status`, `reason`, `preparationMinutes`, or `riderId` (`owner` requests owner-managed delivery).
- `GET /owner/staff` → `StaffMember[]` (managers and riders). **Owner only.**
- `POST /owner/staff` with `{name,email,phone,role: manager|rider}` → `{member, temporaryPassword}`. The temporary password is returned exactly once, the account is created with `must_change_password`, and a duplicate email returns 409. **Owner only.**
- `PATCH /owner/staff/:id` with `{active?,resetPassword?}` → `{member, temporaryPassword?}`. Disabling must also block token refresh. **Owner only.**
- `GET /owner/riders` → `{id,name,available}[]`.
- `POST /owner/menu` → canonical `Food`. Empty ID means create; existing ID means upsert. Accept `stock` when inventory is enabled.
- `GET, POST /owner/categories` → `MenuCategory[]` / saved category. Empty ID creates a category.
- `PATCH /owner/restaurant` → canonical `Restaurant`; extension fields include address, brandingImage, radius (km), hours and holiday date list.
- `GET, POST /owner/coupons` → coupons / saved coupon. Example creation supports fixed discounts; full `Coupon` type also represents percentages and caps.
- `POST /owner/orders/:id/refund` with `{reason}` → updated order. A returned `refund_pending` is not a completed refund.
- `POST /owner/orders/:id/cod-reconciliation` → 2xx only when reconciled.
- `GET /owner/reports?period=monthly` → `{csv}`. Server should escape spreadsheet-formula cells and enforce row/size limits.
- `GET /owner/customers`, `/owner/payments`, `/owner/refunds`, `/owner/reviews`, `/owner/support`, `/owner/delivery-history` → `OwnerRecord[]`.
- `POST /owner/reviews/:id/response` and `/owner/support/:id/response` with `{message}` → 2xx after persistence.

Analytics `netRevenue` is net food revenue: gross food sales minus discounts minus refunds; taxes/delivery collections are separate. Define your actual ledger contract before integration. The sample dashboard is not business data.

## Rider endpoints

- `GET /rider/assignments` and `/rider/history` → assigned `Order[]`.
- `PATCH /rider/assignments/:id` with `{status,otp?}` → updated `Order`.
- Delivery milestones use `deliveryStatus`: `assigned`, `arriving_at_pickup`, `picked_up`, `out_for_delivery`, `delivered`. `Order.status` remains the customer-facing seven-stage status.
- `POST /rider/assignments/:id/location` with `{lat,lng,timestamp}` → 2xx. Validate assignment, coordinate range, freshness and rate limits.
- `POST /rider/assignments/:id/failed` with `{reason}` → 2xx after escalation to the owner.

Return customer contact details only for the authorized active assignment. Revoke them after completion per retention policy. Do not let riders select arbitrary order IDs or update deliveries assigned to someone else.

## Maps, realtime and networking

The order screen polls every 15 seconds. To add Supabase Realtime, replace the polling hook with authorized channel subscriptions and reconnect/freshness logic; do not subscribe to unrestricted table changes. Rider positions must arrive as `rider.location` plus `rider.updatedAt`. Only provide `estimatedArrival` if the backend has a reliable ETA.

Network requests have a 15-second timeout and explicit permission/auth/network error messages. HTTP failures never resolve as a fabricated success. Map/geocoder services have their own provider contracts documented in `MAPPING.md`.

## Server release checklist

- JWT verification, correct issuer/audience and expiry; RLS on exposed tables.
- Trusted role checks and single-restaurant scoping; assignment checks for all GPS/order endpoints.
- Rate limits, input validation, PII minimization, HTTPS, CORS and logging without secrets.
- Atomic order transitions, inventory reservation, idempotent checkout and payment webhooks.
- Cancellation/refund policy, delivery proof, COD reconciliation and audited owner actions.
- Test unavailable services, invalid/stale JWTs, offline reconnect, stale GPS and double submission.
