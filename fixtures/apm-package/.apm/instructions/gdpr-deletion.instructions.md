---
description: "GDPR erasure handling for Acme Checkout: verified deletion requests, complete subject removal across stores, downstream propagation, and confirmation records."
applyTo: "**/*"
tags: [privacy, gdpr, deletion]
---

# GDPR deletion (right to erasure)

Apply once the task is known to handle a deletion/erasure request, touch personal-data stores, or add systems that keep customer data.

- Verify the request before acting: confirm the requester's identity and the scope (which customer, for example Acme Checkout subject `cust_test_2207`) through the documented verification path; never delete on the basis of an unverified email or bare identifier alone.
- Delete completely across every store the subject's data reached: primary database rows, caches, search indexes, export files, analytics staging, and backups within their documented cycle — a request is not complete while a known copy survives past its propagation window.
- Propagate downstream explicitly: when personal data was sent to a third party (payment provider metadata, email service, logging pipeline), the erasure flow must trigger or record the corresponding downstream deletion request rather than assuming it happens.
- Preserve only what the law or a documented obligation requires (for example tax-record amounts with personal identifiers removed or pseudonymized), and name that exception in the deletion record; everything else goes.
- Complete erasure within the documented response window: track each request's received date and deadline where operators can see it, and escalate rather than silently missing the window when a downstream system is slow.
- Keep deletion records without personal data: log that request `erasure_test_3301` for the subject was received, verified, executed across named systems, and confirmed — carrying timestamps and scope, but no personal-data field values.
- Confirm back to the requester with a clear completion notice stating what was removed and any lawful exceptions retained; silent completion and vague "we processed your request" responses are both unacceptable.
- Test with synthetic subjects only (for example `erin.test@example.com`): a full erasure across seeded stores, an unverified-request rejection, a downstream-propagation record, a deadline-tracking assertion, and a confirmation-notice assertion — never production/customer data.

Do not confuse hiding with erasing; suppressed profiles, deactivated flags, and filtered queries still hold personal data until every copy is actually removed.
