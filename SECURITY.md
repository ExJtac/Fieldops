# Security

Do not post credentials, personal employee data, customer files or database copies in public issues. Report a suspected security defect privately to james@cas-tx.com with a minimal synthetic reproduction.

Finish first-run administrator setup through a private local/SSH connection before publishing a writable instance. Use HTTPS, `COOKIE_SECURE=true`, and `APP_ORIGIN` set to the exact public origin. Place the database outside public static directories. Keep session/data backups private and encrypted. SQLite files contain sensitive records and password hashes.

Roles and project grants are enforced on the server. Administrators have organization-wide project access; all other accounts need grants, and workers also inherit assigned projects. The PM staffing directory is shared so managers can plan across crews, while project time, orders and other work records remain scoped. Viewers receive explicitly published summaries, never live private records. Shared warehouse quantities and catalog identities are organization resources.

Supplier quotes, costs and document history are restricted to administrators/purchasing. Payroll permission is a separate explicit grant available only to administrators/PMs/finance accounts, including an explicit grant for the initial administrator. Rates are stored separately from worker records; payroll exports require confirmation, dates, approved coded time and effective rates. Customer sell-price/markup revisions use a separate private store and independent explicit grant. Supplier accounts have an endpoint allowlist, supplier/project scoping, and access only to documents explicitly shared with vendors. Keep financial or personal data out of unrestricted notes.

Public demos must use `DEMO_READ_ONLY=true` and a separate, explicitly marked database with synthetic data. Every HTTP mutation is denied in that mode. Keep complete backups encrypted: the organization JSON export omits login secrets and attachment bytes; the SQLite backup includes them.

Attachment retention requires a matching preview token and typed confirmation. It deletes file blobs only and retains the audit/operational ledger. To decommission an entire installation, stop its service, apply your retention obligations, and securely remove its database and all backup copies through your hosting/storage controls. No public account-purge endpoint exists.

The application has not received an external penetration test or commercial security certification. No uptime, compliance or payroll certification is claimed.

Offline kits are opt-in and encrypted in IndexedDB using a separate passphrase, PBKDF2-SHA256 and AES-GCM. Cache only minimal assigned work; API responses and financial records are never service-worker cached. Lock the kit before sharing a device. Losing the passphrase loses unsynced drafts. Erase the kit and cached shell using its device controls before handing off the device. Server retention does not erase device storage or backups.

Organizations have separate memberships, project grants and entitlements. Disabling membership revokes that workspace's sessions. Transfer ownership before disabling its owner. Billing is off by default; enabling it requires a verified raw-body webhook signature and mapped provider prices. Checkout never grants access from a redirect. Subscription lifecycle tests use simulated provider responses, not live customer payments.

External adapters are disabled until an administrator configures them and the installation operator allows the hostname and provides a signing secret through an environment variable. Outbound delivery requires HTTPS and public DNS addresses, pins the resolved destination, rejects redirects, and signs timestamp + body. Receivers must validate signatures/timestamps and deduplicate event IDs. These are at-least-once notifications, not authoritative data stores.
