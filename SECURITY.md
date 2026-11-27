# Security

Do not post credentials, personal employee data, customer files or database copies in public issues. Report a suspected security defect privately to james@cas-tx.com with a minimal synthetic reproduction.

Finish first-run administrator setup through a private local/SSH connection before publishing a writable instance. Use HTTPS, `COOKIE_SECURE=true`, and `APP_ORIGIN` set to the exact public origin. Place the database outside public static directories. Keep session/data backups private and encrypted. SQLite files contain sensitive records and password hashes.

Roles are enforced on the server. PM and foreman access is organization-wide in 0.1. There is no project-specific access grant model, payroll subsystem or customer sell-price storage. Never put payroll or employee personal information into notes or supplier documents. Public demos must use `DEMO_READ_ONLY=true` and a separate database with synthetic data.

The application has not received an external penetration test or commercial security certification. No uptime, compliance or payroll certification is claimed.
