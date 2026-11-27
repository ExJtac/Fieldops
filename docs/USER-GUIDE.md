# Using CAS FieldOps

Create an account on your private installation, then add a project in Workspace. Add tasks under each section, a target quantity, unit, and an approved hours-per-unit standard if earned-hour reporting is needed. Quoted project field hours and PM hours stay separate. A task's dates become its original baseline; forecast holds never change those dates.

## Materials through installation

1. Add catalog parts, exact manufacturer aliases, suppliers, and storage locations. Units are explicit: `ea`, `ft`, `m`, `box`, `roll`, `hr`. There is no implicit box-to-each conversion; normalize or reconcile source quantities before import.
2. Add BOM requirements or upload CSV/XLSX/JSON from Materials. Review column mappings, exact part match, task IDs, duplicate rows and units. Correct errors before committing. A new source revision updates an existing task/part requirement rather than adding it twice.
3. Record RFQs and supplier quotes. Compare landed costs only where part, quantity, unit and currency match. A recorded RFQ does not send an email.
4. Create a PO with one or more lines, submit it, have an administrator approve it, and mark it issued. Supplier acknowledgement, confirmed delivery dates and ARO forecast ranges remain separate. Use Update ETA after issue to record new promises without changing quantities or prices.
5. Receive partial quantities against an issued PO line, at a storage location. Record a packing-slip reference or condition in the note. Inventory → Evidence accepts PDF, PNG or JPEG files. A PO for 100 units received in two receipts of 60 and 40 still totals 100.
6. Reserve stock to a particular project task. Issuing consumes that task's reservation and reduces on-hand stock. Installing consumes issued stock. One physical unit cannot be reserved twice. Available stock can move between locations; reserved stock must first be released.
7. Return available stock to the supplier or use an administrator reversal to correct a transaction. Dependent movements must be reversed first. Never delete ledger rows. Propose and approve a PO amendment for quantity/cost changes after issue, or create a linked replacement order.

Materials become Ready only when task requirements are covered by reserved, issued or installed quantities, and the task has no release/hold constraint. The project staging buffer (two days by default) is used for late-delivery risk. Missing acknowledgement dates never produce invented ETAs. Approved substitutions must use matching units and cannot reuse a replacement requirement twice on one task.

## Planning people

Add synthetic or appropriately authorized staff records in People & crews. Record trade, crew name, daily capacity and skills with expiration dates. Payroll rates are maintained separately in the restricted Operations center financial screen. Holidays belong to each project's calendar; leave belongs to the person.

Use Resource board to select a week and assign a worker, task, start hour and planned hours. Check Preview capacity & skills before saving. The server also checks on save, including assignments on other projects. Dragging is an alternative to Edit; touch users can tap and edit. Capacity or certification overrides require an explicit manager justification. Current conflicts are recomputed when the workspace refreshes, including new leave or changed calendars.

Date-only planning uses calendar dates rather than elapsed 24-hour intervals, avoiding DST changes to daily capacity. Split shifts crossing midnight into dated entries. An assignment with an override remains a warning for review, not proof that the person can perform conflicting work.

## Time and production

Time follows Draft → Submitted → Approved/Rejected → Locked. A rejected entry can be edited and resubmitted. A locked entry needs a correction request; a manager reopens it with a reason. Until reopened, a pending correction retains the previously approved actual hours. Once reopened, those hours stop contributing until reapproved. Overlapping worker time windows are rejected.

Workers can enter only their own time against assigned projects. Foremen and managers can enter time within their project access; foremen use assigned staff records. PM/admin accounts review time. Enable “Separate request and approval” in Workspace after creating a second approver when your policy requires different requesters and approvers.

Daily production is separately submitted and approved. Approved installed quantity contributes to that task only. Earned hours equal approved installed quantity × approved task unit standard. Physical inventory installation and measured production are distinct transactions; neither silently creates the other. Reconcile the two in your closeout process.

Forecasts show planned, actual, earned and explicitly reforecast remaining hours. Remaining is never guessed as budget minus actual. The scenario calculator changes no saved records. Operations center scenarios include recorded material/site/calendar/dependency/equipment constraints and modeled daily overtime premiums. Named-worker capacity still requires assignment validation; a scenario is not an approved schedule.

## Reports, access and evidence

Use the project filter, then a section filter in Reports. XLSX includes scoped task/labor and material reports; CSV is a labor report; JSON is the versioned integration export. Use Print / PDF for a scoped report or a PO preview. Exports respect role filtering. Audit is project-filtered for PMs and organization-wide for administrators, limited to the most recent 500 events in the UI; the database retains the full trail and record revisions.

Admin and Purchasing can see supplier prices/documents. PM and Foreman receive redacted POs. Worker views show their own assignments/time and assigned-project work. Viewer/GC sees high-level readiness and production, without staff identity, time, or supplier prices. Non-admin accounts need explicit project grants; viewers see only explicitly published summaries.

Attach photos and PDFs from Inventory → Evidence, PO → View, and Timesheets → Evidence. Downloads require an authorized session and matching tenant. Uploads do not send documents to outside services. Files are limited to 5 MB and stored in the same SQLite backup as the records.

Enabled assignment dispatch sends in-app notices to linked worker accounts. No supplier email, GPS, external payroll transmission, paid AI or live Bidlark integration is connected.

## Operations center (0.2)

Use the project selector, then **Operations center** for the expanded workflows.

1. **Purchases:** create shortage RFQs; record and approve quote tiers; create a draft PO from the selected quote. Issued PO changes use **Propose amendment**, then an authorized approval. Split shipments allocate quantities against existing PO lines; mark shipment progress separately from receiving accepted inventory. Returns can support bounded, approved credits. Replacement POs preserve their original reference.
2. **Inventory & assets:** scan/paste an exact catalog barcode, QR value, part number, alias or serial. Register each serialized unit against an accepted receipt. Use **Move unit** to reserve, issue, install, transfer or return it; bulk movement cannot consume registered serials. Report damage as a proposal, then approve it. Receive damaged/quarantined goods with their condition selected; they remain unavailable until an **inspect** movement releases accepted units. A damaged return removes quarantined units without affecting usable stock.
3. **Crew & schedule:** create shift calendars with paid capacity, breaks, working weekdays, holidays and overtime policy. Templates specify trade and role/certification counts. Choose actual workers to build a crew. Date-range staffing skips non-working dates, previews conflicts, and saves the whole range atomically. Equipment and dependency constraints also participate in conflicts. Scenarios compare crews of 2, 4 and 6 using an approved remaining-hours forecast; unresolved constraints leave finish unconfirmed. Leveling previews changes, requires explicit apply, and supports undo unless a later edit would be overwritten. Schedule revisions explicitly distinguish forecast changes from approved baseline revisions.
4. **Field work:** start/stop a timer into a draft timecard, record a check-in, read work instructions/permits/dependencies and acknowledge dispatch. Linked worker accounts review bulk-entered time before PM approval. Use job codes for payroll-ready time. Evidence supports photos and PDFs. Approved production corrections retain the original revision and change earned hours only on approval.
5. **Detailed reports:** select project/section/dates, run the report and choose a table. Download CSV, XLSX, JSON or PDF. Scope notes distinguish period measures from cumulative inventory/forecast balances and project-wide orders from task/section measures. Payroll requires an explicit grant, the export checkbox, approved coded time and effective rates; pending corrections block export.
6. **Access & data:** administrators grant projects to non-admin accounts. A worker also inherits access from active assignments. Publish a project summary explicitly before granting a viewer access to visible progress. Payroll permission is separate, even for administrators. Enable in-app dispatch here and retry failed events when appropriate. Preview retention candidates before typing **DELETE ATTACHMENTS**; operational audit and records remain intact. Export organization JSON for data portability and use the backup command for full recovery including attachment files.

An existing 0.1 installation retains all records. After upgrading, grant projects to PM, purchasing, foreman and viewer accounts; publish viewer summaries explicitly. No financial permissions are granted automatically. A worker without a linked account can have manager-reviewed time; linked workers must review their own submissions.

Never put sensitive payroll values into general notes. Use the restricted rate screen. Use reviewed unit conversions only when a source quantity/package definition is known; select its conversion ID in the import mapping/source and review the normalized quantity. Existing required quantities are revised rather than accumulated.
