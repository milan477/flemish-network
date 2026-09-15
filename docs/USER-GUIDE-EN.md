# Flemish Network — User Guide

This guide follows the current navigation: **Network**, **Collections**, **Grow**, and **Settings**. Labels in bold are the labels shown in the app.

## Access, roles, and navigation

**Purpose:** sign in and understand which controls are available.

1. Sign in with an approved staff email and password.
2. Use **Network**, **Collections**, **Grow**, or **Settings** in the top navigation.
3. Select your name to open **My Account**. Select the sign-out icon to end the session.

- **Viewer:** view and search records and collections.
- **Editor:** also edit records, manage collections, use Grow, and review changes.
- **Admin:** also manage staff access, schedules, and permanent deletion where offered.

## Networks / Map

**Purpose:** find where people and organizations are located.

1. Open **Network** and select **Map**.
2. Enter a name or descriptive request in the search box. Press Enter or choose an autofill result.
3. Open **Filters** and choose **People**, **Organizations**, **People Scope**, **Sector**, **Occupation**, or a **Flemish Connection**.
4. With several criteria active, choose **All** or **Any**.
5. Select a map marker or location cluster to inspect the records there.
6. Select an active filter chip to remove it, or choose **Reset All Filters**.

Search text and filters are separate. Typing a query does not automatically select filter values.

## Networks / List

**Purpose:** scan matching records in a structured list.

1. Open **Network** and select **List**.
2. Search and filter as on the Map view.
3. Open a person or organization card to view the full profile.
4. If a city was selected on the map, clear the focused city to return to all results.
5. Use the available collection or export controls for the displayed results.

## Networks / Stats

**Purpose:** review network distribution and coverage.

1. Open **Network** and select **Stats**.
2. Review totals and charts for locations, sectors, occupations, Flemish connections, and data quality.
3. Select a chart segment or category to focus on that subset.
4. Use the offered **View in Network** action to open the filtered records.

## Person profile

**Purpose:** review one person and maintain the approved record.

1. Open a person from Network or a collection.
2. Review identity, current position, location, contact links, US connections, biography, Flemish connections, and sectors.
3. Editors can select **Edit**, change fields, and select **Save**.
4. Select **Verify** to run an evidence check and review proposed changes before applying them.
5. Select **Add to Collection** to add the person to an existing collection.
6. Use **Print** for a printable profile. Admins can use **Delete** when the approved record must be permanently removed.

## Organization profile

**Purpose:** review an organization and its relationship to the network.

1. Open an organization from Network or a collection.
2. Review type, location, website, description, Flemish connection, sectors, and key contacts.
3. Editors can select **Edit Organization**, change fields, and select **Save Changes**.
4. Select **Verify** to check external evidence.
5. Select **Add to Collection** or open a listed key contact.

## Collections

**Purpose:** create working lists for missions, events, outreach, or research.

1. Open **Collections**.
2. Select **New Collection**.
3. Enter a name and optional description, then save.
4. Select a collection card to open its detail page.

## Collection detail

**Purpose:** manage members and generate targeted suggestions.

1. Review members, edit the collection name or description, add notes, remove members, or export the collection.
2. Select **Find Collection Suggestions**.
3. Open a suggestion to preview it; choose **Approve** or **Reject**. Use **Undo** when needed.
4. Select **Add Approved** to save the approved suggestions as members.
5. Use **Refresh** for a new draft or **Reset** to clear the current draft.
6. If the collection is empty, use **Browse Network** or **Launch Discovery**. Launch Discovery only pre-fills a prompt; the run starts after **Run Discovery** is selected.

## Grow / Import / Add Manually

**Purpose:** enter one pending person or organization.

1. Open **Grow / Import** and select **Add Manually**.
2. Choose **People** or **Organizations**.
3. Enter the known fields, network scope, Flemish connection, and source evidence.
4. Select **Create Pending Contact** or the corresponding organization action.
5. Review the candidate later under **Grow / Verification**.

Manual intake does not change approved records directly.

## Grow / Import / Import File

**Purpose:** create several pending candidates from a file.

1. Open **Grow / Import** and select **Import File**.
2. Choose **People** or **Organizations**.
3. Download a CSV or Excel template if useful, then upload CSV, TSV, TXT, XLS, or XLSX.
4. On **Map Columns**, connect file columns to app fields and select **Preview Import**.
5. On **Confirm Import**, review conflicts and invalid rows.
6. Select **Create Pending Candidates**. Conflicting and invalid rows are skipped.
7. Review the created candidates under **Grow / Verification**.

## Grow / Discovery

**Purpose:** find new candidates from a plain-language request or a suggested search direction.

1. Review **Where to look next**. Use **Refresh proposals** to regenerate suggestions.
2. Select **Launch** on one proposal, or **Launch next proposal**.
3. Alternatively, enter a **Discovery prompt**. Leave it blank for a seeded sweep.
4. Select **Run Discovery**.
5. Follow progress under **Grow / Runs** and review candidates under **Grow / Verification**.

Discovery creates pending people and organizations. It does not approve them.

## Grow / Runs

**Purpose:** monitor discovery and verification work.

1. Open **Grow / Runs**.
2. Review status, start time, duration, outcome, records, activity, and estimated cost.
3. Select **View details** to inspect run steps and errors.
4. Select **Refresh** to reload the list.
5. Use **Cancel** only for a queued or running job that should stop.

The number on the **Runs** tab is the current active-run count.

## Grow / Verification

**Purpose:** decide what happens to newly discovered people and organizations.

For **Pending Discovered People** and **Pending Discovered Organizations**:

1. Wait until verification finishes and the status is **Verified**.
2. Check identity, location, current role or organization type, source evidence, and proposed details.
3. Select **Approve** to create a new approved record.
4. Select **Reject** when the candidate should not be kept.
5. Select **Merge** when the candidate duplicates an existing record; compare the fields before confirming.

Bulk approve excludes detected duplicates. Bulk reject is available only for verified rows.

## Grow / Maintenance

**Purpose:** keep approved records, scheduled agents, and the search index current.

1. Under **Records Freshness**, open an older record and start a check, or select **Mark Current** when no check is needed.
2. Review Discovery and Verification service cards; start a run manually when required.
3. Admins can set a schedule to Off, Light, Normal, or Aggressive.
4. Check the search-index queue and select **Drain now** when pending work should run immediately.
5. Use **Run Housekeeping** to clear stuck runs; cancel an individual stuck run if needed.
6. Under **Profile Update Suggestions** and **Organization Update Suggestions**, compare old and proposed values, evidence, confidence, and risk; then approve or reject selected changes.

## Settings / System

**Purpose:** inspect usage, integrations, and maintenance definitions.

1. Open **Settings / System**.
2. Review today’s API totals and the 14-day Gemini and Tavily chart.
3. Review the visible Light, Normal, and Aggressive run-intensity definitions.
4. Check **Connected Services**.
5. Use the secure links to add backend API keys or manage frontend variables.
6. Select **Test Supabase** to test connectivity and **Refresh** to reload status.

Secret values are managed by the linked service and are not displayed in the app.

## Settings / Access

**Purpose:** manage staff access. This page is admin-only.

1. Enter an email, optional full name, and role.
2. Select **Add Access** to send an invitation.
3. In the staff list, change a name or role and select **Save**.
4. Select **Remove** to revoke the account. The person must be invited again to return.

## Settings / My Account

**Purpose:** maintain your staff profile and password.

1. Select your name in the top navigation or open **Settings / My Account**.
2. Change **Full name** and select **Save Changes**.
3. To change the password, enter and confirm a new password.
4. Use at least 12 characters with uppercase, lowercase, number, and symbol characters.
5. Select the password update button and wait for confirmation.

## Sign in and password recovery

**Purpose:** start a session or request a password reset.

1. On **Staff Sign In**, enter your approved email and password.
2. Select **Sign In**.
3. For a reset, enter the approved email and select **Reset Password**.
4. Open the email link and set a new password on **My Account**.
