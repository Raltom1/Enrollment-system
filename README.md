# School Enrollment and Grading Management System — Setup Guide

## 1. Create the Google Sheet
1. Go to Google Sheets and create a new blank spreadsheet.
2. Rename it, e.g. "SEMS Database".
3. Create these six sheet tabs (exact names, case-sensitive):
   `Users`, `Students`, `Sections`, `Grades`, `Settings`, `ActivityLogs`

## 2. Add column headers (row 1 of each sheet)

**Users**
```
UserID  Username  PasswordHash  Role  Status  CreatedAt
```

**Students**
```
StudentID  LastName  FirstName  MiddleName  Gender  DateOfBirth  ContactNumber  Address  SectionID  Status  CreatedAt  UpdatedAt
```

**Sections**
```
SectionID  SectionName  GradeLevel  Status  CreatedAt  UpdatedAt
```

**Grades**
```
GradeID  StudentID  SectionID  Subject  Grade  SchoolYear  Semester  UpdatedAt
```

**Settings**
```
SettingID  SystemTitle  SchoolName  SchoolYear  Semester  Subjects  PassingGrade  UpdatedAt
```

**ActivityLogs**
```
LogID  UserID  Action  Description  Timestamp
```

## 3. Create your first admin user
Passwords are stored as SHA-256 hashes, never in plain text. To generate a hash for your chosen password:
1. Open the Apps Script project (step 4 below) and run a temporary function once:
   ```javascript
   function getHash() {
     Logger.log(hashPassword("your-chosen-password"));
   }
   ```
2. Copy the logged hash into the `PasswordHash` column of a new row in **Users**, alongside a `UserID` (e.g. `u1`), `Username`, `Role` (`Admin`), and `Status` (`Active`).

## 4. Create the Apps Script project
1. In your spreadsheet, go to **Extensions → Apps Script**.
2. Delete the default `Code.gs` content and paste in the full contents of `google-apps-script/Code.gs` from this project.
3. At the top of the file, replace:
   ```javascript
   const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";
   ```
   with your spreadsheet's ID (the long string between `/d/` and `/edit` in its URL).

## 5. Deploy as a Web App
1. Click **Deploy → New deployment**.
2. Select type **Web app**.
3. Set **Execute as**: `Me`.
4. Set **Who has access**: `Anyone`.
5. Click **Deploy**, authorize the requested permissions, and copy the **Web app URL** it gives you.

## 6. Connect the frontend to the backend
1. Open `script.js`.
2. Replace:
   ```javascript
   API_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
   ```
   with the Web app URL from step 5.

## 7. Add your first school sections
You can add sections directly from the app once logged in (**School Sections → Add Section**), or add rows manually to the **Sections** sheet with a unique `SectionID`, `SectionName`, `GradeLevel`, and `Status` = `Active`.

## 8. Run the app
Open `index.html` in a browser (or host the `index.html`, `style.css`, `script.js` files on any static web host). Log in with the admin username/password you created in step 3.

## 9. Test checklist
- [ ] Log in with correct credentials
- [ ] Log in with a wrong password is rejected
- [ ] Students load from Google Sheets
- [ ] Add a student, confirm a duplicate Student ID is rejected
- [ ] New student appears in the correct section, alphabetically sorted
- [ ] Search finds students by ID/first/last name
- [ ] Transfer a student between sections; confirm no duplicate remains
- [ ] Enter grades outside 0–100 and confirm it is rejected
- [ ] Complete all subject grades and confirm Average/Passed/Failed appear
- [ ] Change Settings and confirm the System Title updates everywhere
- [ ] Disconnect network and confirm cached data still displays
- [ ] Reconnect and confirm data re-synchronizes
- [ ] Resize the browser / open on a phone to confirm responsive layout

## Notes on redeploying Apps Script
Whenever you edit `Code.gs`, you must create a **new deployment version** (Deploy → Manage deployments → Edit → New version) for the changes to take effect on the existing Web app URL.
