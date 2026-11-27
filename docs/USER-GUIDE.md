# Using CAS FieldOps

Create an account on your private installation, then add a project in Workspace. Add tasks under each section, a target quantity, unit, and an approved hours-per-unit standard if earned-hour reporting is needed. Quoted project field hours and PM hours stay separate. A task's dates become its original baseline; forecast holds never change those dates.

## Materials through installation

1. Add catalog parts, exact manufacturer aliases, suppliers, and storage locations. Units are explicit: `ea`, `ft`, `m`, `box`, `roll`, `hr`. There is no implicit box-to-each conversion; normalize or reconcile source quantities before import.
2. Add BOM requirements or upload CSV/XLSX/JSON from Materials. Review column mappings, exact part match, task IDs, duplicate rows and units. Correct errors before committing. A new source revision updates an existing task/part requirement rather than adding it twice.
3. Record RFQs and supplier quotes. Compare landed costs only where part, quantity, unit and currency match. A recorded RFQ does not send an email.
4. Create a PO with one or more lines, submit it, have an administrator approve it, and mark it issued. Supplier acknowledgement, confirmed delivery dates and ARO forecast ranges remain separate. Use Update ETA after issue to record new promises without changing quantities or prices.
5. Receive partial quantities against an issued PO line, at a storage location. Record a packing-slip reference or condition in the note. Inventory → Evidence accepts PDF, PNG or JPEG files. A PO for 100 units received in two receipts of 60 and 40 still totals 100.
6. Reserve stock to a particular project task. Issuing consumes that task's reservation and reduces on-hand stock. Installing consumes issued stock. One physical unit cannot be reserved twice. Available stock can move between locations; reserved stock must first be released.
7. Return available stock to the supplier or use an administrator reversal to correct a transaction. Dependent movements must be reversed first. Never delete ledger rows. Cancel a PO's remaining balance and create a replacement order for quantity or cost changes after issue.

Materials become Ready only when task requirements are covered by reserved, issued or installed quantities, and the task has no release/hold constraint. Two days of receiving/staging buffer are used for late-delivery risk. Missing acknowledgement dates never produce invented ETAs. Approved substitutions must use matching units and cannot reuse a replacement requirement twice on one task.

## Planning people

Add synthetic or appropriately authorized staff records in People & crews. Record trade, crew name, daily capacity and skills with expiration dates. There are no private payroll fields. Holidays belong to each project's calendar; leave belongs to the person.

Use Resource board to select a week and assign a worker, task, start hour and planned hours. Check Preview capacity & skills before saving. The server also checks on save, including assignments on other projects. Dragging is an alternative to Edit; touch users can tap and edit. Capacity or certification overrides require an explicit manager justification. Current conflicts are recomputed when the workspace refreshes, including new leave or changed calendars.

Date-only planning uses calendar dates rather than elapsed 24-hour intervals, avoiding DST changes to daily capacity. Split shifts crossing midnight into dated entries. An assignment with an override remains a warning for review, not proof that the person can perform conflicting work.

## Time and production

Time follows Draft → Submitted → Approved/Rejected → Locked. A rejected entry can be edited and resubmitted. A locked entry needs a correction request; a manager reopens it with a reason. Until reopened, a pending correction retains the previously approved actual hours. Once reopened, those hours stop contributing until reapproved. Overlapping worker time windows are rejected.

Workers can enter only their own time against assigned projects. Foremen and managers can enter time for staff in the organization. PM/admin accounts review time. Enable “Separate request and approval” in Workspace after creating a second approver when your policy requires different requesters and approvers.

Daily production is separately submitted and approved. Approved installed quantity contributes to that task only. Earned hours equal approved installed quantity × approved task unit standard. Physical inventory installation and measured production are distinct transactions; neither silently creates the other. Reconcile the two in your closeout process.

Forecasts show planned, actual, earned and explicitly reforecast remaining hours. Remaining is never guessed as budget minus actual. The scenario calculator changes no saved records. It uses an entered blended cost and omits material/site/holiday constraints and automatic overtime premiums; treat its duration as capacity arithmetic, not an approved schedule.

## Reports, access and evidence

Use the project filter, then a section filter in Reports. XLSX includes scoped task/labor and material reports; CSV is a labor report; JSON is the versioned integration export. Use Print / PDF for a scoped report or a PO preview. Exports respect role filtering. Audit is workspace-wide and limited to the most recent 500 events in the UI; the database retains the full trail and record revisions.

Admin and Purchasing can see supplier prices/documents. PM and Foreman receive redacted POs. Worker views show their own assignments/time and assigned-project work. Viewer/GC sees high-level readiness and production, without staff identity, time, or supplier prices. PM/Foreman are currently organization-wide; deploy a separate installation for customers who need stricter project membership boundaries.

Attach photos and PDFs from Inventory → Evidence, PO → View, and Timesheets → Evidence. Downloads require an authorized session and matching tenant. Uploads do not send documents to outside services. Files are limited to 5 MB and stored in the same SQLite backup as the records.

No staff notification or supplier email is sent. No GPS, payroll, paid AI, or live Bidlark integration is connected.
