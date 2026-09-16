/**
 * ==============================================================
 * SCHOOL ENROLLMENT AND GRADING MANAGEMENT SYSTEM — BACKEND
 * Google Apps Script (Code.gs)
 *
 * This script is the ONLY thing that talks to the Google Sheets
 * spreadsheet. The frontend never touches the sheet directly.
 * Deploy this as a Web App (Execute as: Me, Access: Anyone)
 * and paste the resulting URL into CONFIG.API_URL in script.js.
 * ==============================================================
 */

// ---------- CONFIG ----------
// Paste your Google Sheet ID here (the long string in the sheet's URL).
const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";

const SHEETS = {
  USERS: "Users",
  STUDENTS: "Students",
  SECTIONS: "Sections",
  GRADES: "Grades",
  SETTINGS: "Settings",
  LOGS: "ActivityLogs"
};

// ---------- ENTRY POINTS ----------
function doPost(e) {
  return handleRequest(e);
}
function doGet(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  let action = "";
  let payload = {};
  let token = null;
  try {
    if (e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      action = body.action;
      payload = body.payload || {};
      token = body.token || null;
    } else if (e.parameter) {
      action = e.parameter.action;
      payload = e.parameter;
      token = e.parameter.token || null;
    }

    const PUBLIC_ACTIONS = ["login"];
    if (PUBLIC_ACTIONS.indexOf(action) === -1) {
      const session = validateToken(token);
      if (!session) return jsonResponse({ success: false, message: "Session expired. Please log in again." });
    }

    let data;
    switch (action) {
      case "login": data = actionLogin(payload); break;
      case "getSnapshot": data = actionGetSnapshot(); break;
      case "getStudents": data = actionGetStudents(); break;
      case "addStudent": data = actionAddStudent(payload); break;
      case "updateStudent": data = actionUpdateStudent(payload); break;
      case "transferStudent": data = actionTransferStudent(payload); break;
      case "getSections": data = actionGetSections(); break;
      case "addSection": data = actionAddSection(payload); break;
      case "updateSection": data = actionUpdateSection(payload); break;
      case "getGrades": data = actionGetGrades(); break;
      case "saveGrades": data = actionSaveGrades(payload); break;
      case "getSettings": data = actionGetSettings(); break;
      case "updateSettings": data = actionUpdateSettings(payload); break;
      default: return jsonResponse({ success: false, message: "Unknown action: " + action });
    }
    return jsonResponse({ success: true, message: "OK", data: data });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message || "Server error" });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- SHEET HELPERS ----------
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet: " + name);
  return sheet;
}
function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = values.slice(1).filter(r => r.join("") !== "");
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}
function appendRow(sheet, headers, obj) {
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  sheet.appendRow(row);
}
function getHeaders(sheet) {
  return sheet.getDataRange().getValues()[0];
}
function findRowIndexByKey(sheet, keyColumn, keyValue) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const colIndex = headers.indexOf(keyColumn);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][colIndex]) === String(keyValue)) return i + 1; // 1-based row number
  }
  return -1;
}
function updateRowByKey(sheet, keyColumn, keyValue, updates) {
  const rowNum = findRowIndexByKey(sheet, keyColumn, keyValue);
  if (rowNum === -1) throw new Error("Record not found: " + keyValue);
  const headers = getHeaders(sheet);
  headers.forEach((h, i) => {
    if (updates.hasOwnProperty(h)) {
      sheet.getRange(rowNum, i + 1).setValue(updates[h]);
    }
  });
  const updatedValues = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach((h, i) => { obj[h] = updatedValues[i]; });
  return obj;
}
function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return prefix + "_" + Utilities.getUuid().slice(0, 8); }
function hashPassword(plain) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plain);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}
function logActivity(userId, actionName, description) {
  try {
    const sheet = getSheet(SHEETS.LOGS);
    appendRow(sheet, getHeaders(sheet), {
      LogID: newId("log"), UserID: userId, Action: actionName,
      Description: description, Timestamp: nowIso()
    });
  } catch (e) { /* logging must never break the main request */ }
}

// ---------- SESSION (simple in-sheet token check via cache) ----------
// A lightweight session store using Apps Script's CacheService so we do not
// need an extra sheet just for active tokens. Tokens expire after 6 hours.
function validateToken(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get("session_" + token);
  return raw ? JSON.parse(raw) : null;
}
function createSession(username, role) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put("session_" + token, JSON.stringify({ username, role }), 6 * 60 * 60); // 6 hours
  return token;
}

// ---------- AUTH ----------
function actionLogin(payload) {
  const username = (payload.username || "").trim();
  const password = payload.password || "";
  if (!username || !password) throw new Error("Username and password are required.");
  const users = sheetToObjects(getSheet(SHEETS.USERS));
  const user = users.find(u => String(u.Username).toLowerCase() === username.toLowerCase());
  if (!user) throw new Error("Invalid username or password.");
  if (user.Status && String(user.Status).toLowerCase() === "inactive") throw new Error("This account is inactive.");
  if (hashPassword(password) !== user.PasswordHash) throw new Error("Invalid username or password.");
  const token = createSession(user.Username, user.Role || "Admin");
  logActivity(user.UserID, "LOGIN", "User logged in.");
  return { username: user.Username, role: user.Role || "Admin", token: token };
}

// ---------- SNAPSHOT (used by initial load + polling) ----------
function actionGetSnapshot() {
  return {
    students: actionGetStudents(),
    sections: actionGetSections(),
    grades: actionGetGrades(),
    settings: actionGetSettings()
  };
}

// ---------- STUDENTS ----------
function actionGetStudents() {
  return sheetToObjects(getSheet(SHEETS.STUDENTS));
}
function actionAddStudent(payload) {
  const sheet = getSheet(SHEETS.STUDENTS);
  const existing = sheetToObjects(sheet);
  if (existing.some(s => String(s.StudentID) === String(payload.StudentID))) {
    throw new Error("Student ID already exists.");
  }
  if (!payload.StudentID || !payload.LastName || !payload.FirstName || !payload.SectionID) {
    throw new Error("Missing required student fields.");
  }
  const sections = sheetToObjects(getSheet(SHEETS.SECTIONS));
  if (!sections.some(sec => String(sec.SectionID) === String(payload.SectionID))) {
    throw new Error("Selected section does not exist.");
  }
  const record = {
    StudentID: payload.StudentID,
    LastName: payload.LastName,
    FirstName: payload.FirstName,
    MiddleName: payload.MiddleName || "",
    Gender: payload.Gender || "",
    DateOfBirth: payload.DateOfBirth || "",
    ContactNumber: payload.ContactNumber || "",
    Address: payload.Address || "",
    SectionID: payload.SectionID,
    Status: "Active",
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
  appendRow(sheet, getHeaders(sheet), record);
  logActivity("system", "ADD_STUDENT", "Added student " + record.StudentID);
  return record;
}
function actionUpdateStudent(payload) {
  const sheet = getSheet(SHEETS.STUDENTS);
  const updates = {
    LastName: payload.LastName,
    FirstName: payload.FirstName,
    MiddleName: payload.MiddleName || "",
    Gender: payload.Gender,
    DateOfBirth: payload.DateOfBirth || "",
    ContactNumber: payload.ContactNumber || "",
    Address: payload.Address || "",
    SectionID: payload.SectionID,
    UpdatedAt: nowIso()
  };
  const updated = updateRowByKey(sheet, "StudentID", payload.StudentID, updates);
  logActivity("system", "UPDATE_STUDENT", "Updated student " + payload.StudentID);
  return updated;
}
function actionTransferStudent(payload) {
  const sheet = getSheet(SHEETS.STUDENTS);
  const sections = sheetToObjects(getSheet(SHEETS.SECTIONS));
  if (!sections.some(sec => String(sec.SectionID) === String(payload.NewSectionID))) {
    throw new Error("Target section does not exist.");
  }
  // RULE: transferring updates the existing student's SectionID field in
  // place rather than creating a duplicate student record, so the student
  // disappears from the old section and appears only in the new one.
  const updated = updateRowByKey(sheet, "StudentID", payload.StudentID, {
    SectionID: payload.NewSectionID,
    UpdatedAt: nowIso()
  });
  logActivity("system", "TRANSFER_STUDENT", "Transferred " + payload.StudentID + " to " + payload.NewSectionID);
  return updated;
}

// ---------- SECTIONS ----------
function actionGetSections() {
  return sheetToObjects(getSheet(SHEETS.SECTIONS));
}
function actionAddSection(payload) {
  const sheet = getSheet(SHEETS.SECTIONS);
  const existing = sheetToObjects(sheet);
  const dup = existing.some(s =>
    String(s.GradeLevel).toLowerCase() === String(payload.GradeLevel).toLowerCase() &&
    String(s.SectionName).toLowerCase() === String(payload.SectionName).toLowerCase());
  if (dup) throw new Error("This section already exists.");
  const record = {
    SectionID: newId("sec"),
    SectionName: payload.SectionName,
    GradeLevel: payload.GradeLevel,
    Status: "Active",
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
  appendRow(sheet, getHeaders(sheet), record);
  logActivity("system", "ADD_SECTION", "Added section " + record.GradeLevel + "-" + record.SectionName);
  return record;
}
function actionUpdateSection(payload) {
  const sheet = getSheet(SHEETS.SECTIONS);
  const updated = updateRowByKey(sheet, "SectionID", payload.SectionID, {
    SectionName: payload.SectionName,
    GradeLevel: payload.GradeLevel,
    Status: payload.Status,
    UpdatedAt: nowIso()
  });
  logActivity("system", "UPDATE_SECTION", "Updated section " + payload.SectionID);
  return updated;
}

// ---------- GRADES ----------
function actionGetGrades() {
  return sheetToObjects(getSheet(SHEETS.GRADES));
}
function actionSaveGrades(payload) {
  const sheet = getSheet(SHEETS.GRADES);
  const headers = getHeaders(sheet);
  const records = payload.records || [];
  const settings = actionGetSettings();
  const schoolYear = settings.SchoolYear || "";
  const semester = settings.Semester || "";

  records.forEach(rec => {
    const grade = Number(rec.Grade);
    if (isNaN(grade) || grade < 0 || grade > 100) {
      throw new Error("Grade must be between 0 and 100.");
    }
  });

  const existingValues = sheet.getDataRange().getValues();
  const existingHeaders = existingValues[0];
  const idxStudent = existingHeaders.indexOf("StudentID");
  const idxSection = existingHeaders.indexOf("SectionID");
  const idxSubject = existingHeaders.indexOf("Subject");
  const idxGrade = existingHeaders.indexOf("Grade");
  const idxUpdated = existingHeaders.indexOf("UpdatedAt");

  records.forEach(rec => {
    let foundRow = -1;
    for (let i = 1; i < existingValues.length; i++) {
      if (String(existingValues[i][idxStudent]) === String(rec.StudentID) &&
          String(existingValues[i][idxSection]) === String(rec.SectionID) &&
          String(existingValues[i][idxSubject]) === String(rec.Subject)) {
        foundRow = i + 1;
        break;
      }
    }
    if (foundRow !== -1) {
      sheet.getRange(foundRow, idxGrade + 1).setValue(Number(rec.Grade));
      sheet.getRange(foundRow, idxUpdated + 1).setValue(nowIso());
    } else {
      appendRow(sheet, headers, {
        GradeID: newId("grd"),
        StudentID: rec.StudentID,
        SectionID: rec.SectionID,
        Subject: rec.Subject,
        Grade: Number(rec.Grade),
        SchoolYear: schoolYear,
        Semester: semester,
        UpdatedAt: nowIso()
      });
    }
  });
  logActivity("system", "SAVE_GRADES", "Saved " + records.length + " grade record(s).");
  return { saved: records.length };
}

// ---------- SETTINGS ----------
function actionGetSettings() {
  const rows = sheetToObjects(getSheet(SHEETS.SETTINGS));
  if (rows.length === 0) {
    return {
      SystemTitle: "School Enrollment Management System",
      SchoolName: "", SchoolYear: "", Semester: "1st",
      Subjects: "English,Mathematics,Science,Filipino,Araling Panlipunan",
      PassingGrade: 75
    };
  }
  return rows[0];
}
function actionUpdateSettings(payload) {
  const sheet = getSheet(SHEETS.SETTINGS);
  const rows = sheetToObjects(sheet);
  const updates = {
    SystemTitle: payload.SystemTitle,
    SchoolName: payload.SchoolName,
    SchoolYear: payload.SchoolYear,
    Semester: payload.Semester,
    Subjects: payload.Subjects,
    PassingGrade: payload.PassingGrade,
    UpdatedAt: nowIso()
  };
  if (rows.length === 0) {
    const headers = getHeaders(sheet);
    const record = { SettingID: newId("set"), ...updates };
    appendRow(sheet, headers, record);
    return record;
  }
  const settingId = rows[0].SettingID;
  return updateRowByKey(sheet, "SettingID", settingId, updates);
}
