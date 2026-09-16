/* =========================================================
   SCHOOL ENROLLMENT MANAGEMENT SYSTEM — APP LOGIC
   Organized into modules. Everything talks to Google Apps
   Script through the CONFIG.API_URL endpoint, and caches
   through LocalStorage. Google Sheets is always the source
   of truth; LocalStorage is only a convenience cache.
   ========================================================= */

/* ================= 1. CONFIG ================= */
const CONFIG = {
  // Paste your deployed Google Apps Script Web App URL here.
  API_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
  POLL_INTERVAL_MS: 8000,
  STORAGE_PREFIX: "sems_"
};

/* ================= 2. STATE ================= */
const STATE = {
  session: null,          // { username, role, token }
  students: [],
  sections: [],
  grades: [],             // flat list { StudentID, Section-scoped subject grades... } normalized below
  settings: {
    SystemTitle: "School Enrollment Management System",
    SchoolName: "",
    SchoolYear: "",
    Semester: "1st",
    Subjects: "English,Mathematics,Science,Filipino,Araling Panlipunan",
    PassingGrade: 75
  },
  currentSection: null,      // section object currently open in modal
  currentActionStudent: null,// student object currently targeted by action modal
  enrollmentSort: { field: "LastName", dir: "asc" },
  pollTimer: null,
  isOnline: true
};

/* ================= 3. LOCALSTORAGE MANAGER ================= */
const Store = {
  key(name) { return CONFIG.STORAGE_PREFIX + name; },
  get(name, fallback = null) {
    try {
      const raw = localStorage.getItem(this.key(name));
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  set(name, value) {
    try { localStorage.setItem(this.key(name), JSON.stringify(value)); }
    catch (e) { console.warn("LocalStorage write failed", e); }
  },
  remove(name) { localStorage.removeItem(this.key(name)); },
  clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CONFIG.STORAGE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }
};

/* ================= 4. API LAYER ================= */
/* Uses text/plain POST body to avoid CORS preflight issues with
   Google Apps Script web apps (a well-known GAS + fetch pattern). */
const Api = {
  async call(action, payload = {}) {
    if (!CONFIG.API_URL || CONFIG.API_URL.includes("PASTE_YOUR")) {
      throw new Error("API_URL is not configured yet.");
    }
    const body = JSON.stringify({
      action,
      payload,
      token: STATE.session ? STATE.session.token : null
    });
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body
    });
    if (!res.ok) throw new Error("Network response was not ok (" + res.status + ")");
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Request failed");
    return json.data;
  }
};

/* ================= 5. TOAST MANAGER ================= */
const Toast = {
  show(message, type = "info") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast toast-" + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 220);
    }, 3600);
  },
  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error"); },
  warning(msg) { this.show(msg, "warning"); },
  info(msg) { this.show(msg, "info"); }
};

/* ================= 6. MODAL MANAGER ================= */
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
};
document.addEventListener("click", (e) => {
  const closeAttr = e.target.closest("[data-close]");
  if (closeAttr) Modal.close(closeAttr.getAttribute("data-close"));
  if (e.target.classList.contains("modal-overlay")) e.target.hidden = true;
});

/* ================= 7. SORTING / SEARCH UTILITIES ================= */
function sortStudents(list, field = "LastName", dir = "asc") {
  const sorted = [...list].sort((a, b) => {
    const primary = compareField(a, b, "LastName");
    if (field === "LastName" && primary !== 0) return dir === "asc" ? primary : -primary;
    if (primary !== 0 && field === "LastName") return primary;
    // default chain: LastName -> FirstName -> MiddleName
    const chainFields = field === "LastName" ? ["LastName", "FirstName", "MiddleName"] : [field, "LastName", "FirstName", "MiddleName"];
    for (const f of chainFields) {
      const c = compareField(a, b, f);
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return 0;
  });
  return sorted;
}
function compareField(a, b, field) {
  const av = (a[field] || "").toString().toLowerCase();
  const bv = (b[field] || "").toString().toLowerCase();
  return av.localeCompare(bv);
}
function studentMatchesSearch(student, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const full = `${student.FirstName} ${student.LastName} ${student.MiddleName || ""}`.toLowerCase();
  return (
    (student.StudentID || "").toLowerCase().includes(q) ||
    (student.LastName || "").toLowerCase().includes(q) ||
    (student.FirstName || "").toLowerCase().includes(q) ||
    full.includes(q)
  );
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ================= 8. AUTH MODULE ================= */
const Auth = {
  init() {
    const session = Store.get("session");
    if (session && session.token) {
      STATE.session = session;
      App.enterApp();
    } else {
      App.showLogin();
    }
    document.getElementById("login-form").addEventListener("submit", this.handleLogin.bind(this));
    document.getElementById("logout-btn").addEventListener("click", this.logout.bind(this));
  },
  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("login-submit-btn");
    errorEl.hidden = true;
    this.setLoading(btn, true);
    try {
      const data = await Api.call("login", { username, password });
      STATE.session = { username: data.username, role: data.role, token: data.token };
      Store.set("session", STATE.session);
      Toast.success("Welcome back, " + data.username + ".");
      App.enterApp();
    } catch (err) {
      errorEl.textContent = err.message || "Invalid username or password.";
      errorEl.hidden = false;
    } finally {
      this.setLoading(btn, false);
    }
  },
  setLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector(".btn-label").style.visibility = loading ? "hidden" : "visible";
    btn.querySelector(".spinner").hidden = !loading;
  },
  logout() {
    STATE.session = null;
    Store.remove("session");
    Polling.stop();
    Toast.info("You have been logged out.");
    App.showLogin();
  }
};

/* ================= 9. SIDEBAR / NAVIGATION ================= */
const Nav = {
  init() {
    document.querySelectorAll(".nav-item[data-page]").forEach(btn => {
      btn.addEventListener("click", () => this.goTo(btn.dataset.page));
    });
    document.getElementById("hamburger-btn").addEventListener("click", () => this.toggleSidebar());
    document.getElementById("sidebar-overlay").addEventListener("click", () => this.closeSidebar());
  },
  goTo(page) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".nav-item[data-page]").forEach(n => n.classList.remove("active"));
    document.getElementById("page-" + page).classList.add("active");
    document.querySelector(`.nav-item[data-page="${page}"]`).classList.add("active");
    document.getElementById("topbar-title").textContent =
      document.querySelector(`.nav-item[data-page="${page}"] span`).textContent;
    this.closeSidebar();
  },
  toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebar-overlay").classList.toggle("show");
  },
  closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("show");
  }
};

/* ================= 10. DASHBOARD ================= */
const Dashboard = {
  render() {
    const totalStudents = STATE.students.length;
    const totalEnrolled = STATE.students.filter(s => s.Status !== "Inactive").length;
    const totalSections = STATE.sections.length;
    const gradedIds = new Set(STATE.grades.filter(g => g.Grade !== "" && g.Grade !== null && g.Grade !== undefined).map(g => g.StudentID));
    const withGrades = gradedIds.size;
    const withoutGrades = Math.max(totalStudents - withGrades, 0);

    document.getElementById("stat-total-students").textContent = totalStudents;
    document.getElementById("stat-total-enrolled").textContent = totalEnrolled;
    document.getElementById("stat-total-sections").textContent = totalSections;
    document.getElementById("stat-with-grades").textContent = withGrades;
    document.getElementById("stat-without-grades").textContent = withoutGrades;

    const grid = document.getElementById("dashboard-section-grid");
    grid.innerHTML = "";
    STATE.sections.forEach(sec => {
      const count = STATE.students.filter(s => s.SectionID === sec.SectionID).length;
      const card = document.createElement("div");
      card.className = "section-card";
      card.innerHTML = `
        <h4>${escapeHtml(sec.GradeLevel)} - ${escapeHtml(sec.SectionName)}</h4>
        <p class="count">${count} student${count === 1 ? "" : "s"}</p>
        <span class="status-badge ${sec.Status === "Active" ? "badge-success" : "badge-danger"}">${escapeHtml(sec.Status || "Active")}</span>
      `;
      card.addEventListener("click", () => Sections.openSectionModal(sec));
      grid.appendChild(card);
    });
  }
};

/* ================= 11. SECTIONS MODULE ================= */
const Sections = {
  init() {
    document.getElementById("add-section-btn").addEventListener("click", () => Modal.open("modal-add-section"));
    document.getElementById("add-section-form").addEventListener("submit", this.handleAddSection.bind(this));
    document.getElementById("section-modal-search").addEventListener("input", () => this.renderSectionModalTable());
  },
  render() {
    const grid = document.getElementById("sections-grid");
    grid.innerHTML = "";
    STATE.sections.forEach(sec => {
      const count = STATE.students.filter(s => s.SectionID === sec.SectionID).length;
      const card = document.createElement("div");
      card.className = "section-card";
      card.innerHTML = `
        <h4>${escapeHtml(sec.GradeLevel)} - ${escapeHtml(sec.SectionName)}</h4>
        <p class="count">Students: ${count}</p>
        <span class="status-badge ${sec.Status === "Active" ? "badge-success" : "badge-danger"}">${escapeHtml(sec.Status || "Active")}</span>
      `;
      card.addEventListener("click", () => this.openSectionModal(sec));
      grid.appendChild(card);
    });
    this.populateSectionDropdowns();
  },
  populateSectionDropdowns() {
    const opts = STATE.sections.map(s => `<option value="${s.SectionID}">${escapeHtml(s.GradeLevel)} - ${escapeHtml(s.SectionName)}</option>`).join("");
    document.getElementById("f-section").innerHTML = `<option value="">Select Section</option>` + opts;
    document.getElementById("transfer-new-section").innerHTML = opts;
    document.getElementById("grading-section-select").innerHTML = `<option value="">-- Select School Section --</option>` + opts;
  },
  openSectionModal(sec) {
    STATE.currentSection = sec;
    document.getElementById("section-modal-title").textContent = `${sec.GradeLevel} - ${sec.SectionName}`;
    document.getElementById("section-modal-search").value = "";
    this.renderSectionModalTable();
    Modal.open("modal-section");
  },
  renderSectionModalTable() {
    const sec = STATE.currentSection;
    if (!sec) return;
    const query = document.getElementById("section-modal-search").value;
    let list = STATE.students.filter(s => s.SectionID === sec.SectionID);
    list = sortStudents(list, "LastName", "asc").filter(s => studentMatchesSearch(s, query));
    document.getElementById("section-modal-count").textContent = `${list.length} student${list.length === 1 ? "" : "s"}`;
    const tbody = document.getElementById("section-modal-tbody");
    tbody.innerHTML = "";
    document.getElementById("section-modal-empty").hidden = list.length !== 0;
    list.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.StudentID)}</td>
        <td>${escapeHtml(s.LastName)}, ${escapeHtml(s.FirstName)}</td>
        <td>${escapeHtml(s.Gender)}</td>
        <td>${escapeHtml(sec.GradeLevel)}-${escapeHtml(sec.SectionName)}</td>
        <td><button class="table-action-btn" data-action-id="${escapeHtml(s.StudentID)}">Action</button></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-action-id]").forEach(btn => {
      btn.addEventListener("click", () => Students.openActionModal(btn.dataset.actionId));
    });
  },
  async handleAddSection(e) {
    e.preventDefault();
    const gradeLevel = document.getElementById("f-grade-level").value.trim();
    const sectionName = document.getElementById("f-section-name").value.trim();
    const btn = e.target.querySelector("button[type=submit]");
    Auth.setLoading(btn, true);
    try {
      const dup = STATE.sections.some(s =>
        s.GradeLevel.toLowerCase() === gradeLevel.toLowerCase() &&
        s.SectionName.toLowerCase() === sectionName.toLowerCase());
      if (dup) throw new Error("This section already exists.");
      const newSection = await Api.call("addSection", { GradeLevel: gradeLevel, SectionName: sectionName });
      STATE.sections.push(newSection);
      Store.set("sections", STATE.sections);
      this.render();
      Dashboard.render();
      Modal.close("modal-add-section");
      e.target.reset();
      Toast.success("Section created successfully.");
    } catch (err) {
      Toast.error(err.message || "Unable to create section.");
    } finally {
      Auth.setLoading(btn, false);
    }
  }
};

/* ================= 12. STUDENTS / ENROLLMENT MODULE ================= */
const Students = {
  init() {
    document.getElementById("add-student-btn").addEventListener("click", () => this.openStudentModal("add"));
    document.getElementById("student-form").addEventListener("submit", this.handleSaveStudent.bind(this));
    document.getElementById("enrollment-search").addEventListener("input", () => this.renderEnrollmentTable());
    document.querySelectorAll("#enrollment-table th[data-sort]").forEach(th => {
      th.addEventListener("click", () => {
        const field = th.dataset.sort;
        if (STATE.enrollmentSort.field === field) {
          STATE.enrollmentSort.dir = STATE.enrollmentSort.dir === "asc" ? "desc" : "asc";
        } else {
          STATE.enrollmentSort = { field, dir: "asc" };
        }
        this.renderEnrollmentTable();
      });
    });

    // Action modal buttons
    document.getElementById("action-view-btn").addEventListener("click", () => this.viewStudent());
    document.getElementById("action-edit-btn").addEventListener("click", () => this.editStudent());
    document.getElementById("action-transfer-btn").addEventListener("click", () => this.openTransferModal());
    document.getElementById("confirm-transfer-btn").addEventListener("click", () => this.confirmTransfer());
  },

  sectionLabel(sectionId) {
    const sec = STATE.sections.find(s => s.SectionID === sectionId);
    return sec ? `${sec.GradeLevel}-${sec.SectionName}` : "Unassigned";
  },

  renderEnrollmentTable() {
    const query = document.getElementById("enrollment-search").value;
    let list = STATE.students.filter(s => studentMatchesSearch(s, query));
    list = sortStudents(list, STATE.enrollmentSort.field, STATE.enrollmentSort.dir);
    const tbody = document.getElementById("enrollment-tbody");
    tbody.innerHTML = "";
    document.getElementById("enrollment-empty").hidden = list.length !== 0;
    list.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.StudentID)}</td>
        <td>${escapeHtml(s.LastName)}</td>
        <td>${escapeHtml(s.FirstName)}</td>
        <td>${escapeHtml(s.MiddleName)}</td>
        <td>${escapeHtml(s.Gender)}</td>
        <td>${escapeHtml(this.sectionLabel(s.SectionID))}</td>
        <td><span class="status-badge ${s.Status === "Inactive" ? "badge-danger" : "badge-success"}">${escapeHtml(s.Status || "Active")}</span></td>
        <td><button class="table-action-btn" data-action-id="${escapeHtml(s.StudentID)}">Action</button></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-action-id]").forEach(btn => {
      btn.addEventListener("click", () => this.openActionModal(btn.dataset.actionId));
    });
  },

  openStudentModal(mode, student = null) {
    document.getElementById("student-form-mode").value = mode;
    document.getElementById("student-modal-title").textContent = mode === "edit" ? "Edit Student" : "Add Student";
    const form = document.getElementById("student-form");
    form.reset();
    document.getElementById("f-student-id").disabled = mode === "edit";
    if (student) {
      document.getElementById("f-student-id").value = student.StudentID;
      document.getElementById("f-last-name").value = student.LastName;
      document.getElementById("f-first-name").value = student.FirstName;
      document.getElementById("f-middle-name").value = student.MiddleName || "";
      document.getElementById("f-gender").value = student.Gender;
      document.getElementById("f-dob").value = student.DateOfBirth || "";
      document.getElementById("f-contact").value = student.ContactNumber || "";
      document.getElementById("f-address").value = student.Address || "";
      document.getElementById("f-section").value = student.SectionID || "";
      form.dataset.editingId = student.StudentID;
    } else {
      delete form.dataset.editingId;
    }
    Modal.open("modal-student");
  },

  async handleSaveStudent(e) {
    e.preventDefault();
    const mode = document.getElementById("student-form-mode").value;
    const btn = e.target.querySelector("button[type=submit]");
    const payload = {
      StudentID: document.getElementById("f-student-id").value.trim(),
      LastName: document.getElementById("f-last-name").value.trim(),
      FirstName: document.getElementById("f-first-name").value.trim(),
      MiddleName: document.getElementById("f-middle-name").value.trim(),
      Gender: document.getElementById("f-gender").value,
      DateOfBirth: document.getElementById("f-dob").value,
      ContactNumber: document.getElementById("f-contact").value.trim(),
      Address: document.getElementById("f-address").value.trim(),
      SectionID: document.getElementById("f-section").value
    };
    if (!payload.StudentID || !payload.LastName || !payload.FirstName || !payload.Gender || !payload.SectionID) {
      Toast.warning("Please fill in all required fields.");
      return;
    }
    Auth.setLoading(btn, true);
    try {
      if (mode === "add") {
        if (STATE.students.some(s => s.StudentID === payload.StudentID)) {
          throw new Error("Student ID already exists.");
        }
        const created = await Api.call("addStudent", payload);
        STATE.students.push(created);
        Toast.success("Student added successfully.");
      } else {
        const updated = await Api.call("updateStudent", payload);
        const idx = STATE.students.findIndex(s => s.StudentID === payload.StudentID);
        if (idx !== -1) STATE.students[idx] = updated;
        Toast.success("Student updated successfully.");
      }
      Store.set("students", STATE.students);
      Modal.close("modal-student");
      this.renderAll();
    } catch (err) {
      Toast.error(err.message || "Unable to save student.");
    } finally {
      Auth.setLoading(btn, false);
    }
  },

  openActionModal(studentId) {
    const student = STATE.students.find(s => s.StudentID === studentId);
    if (!student) return;
    STATE.currentActionStudent = student;
    document.getElementById("action-modal-student-name").textContent =
      `${student.LastName}, ${student.FirstName} (${student.StudentID})`;
    Modal.open("modal-action");
  },

  viewStudent() {
    const s = STATE.currentActionStudent;
    if (!s) return;
    Modal.close("modal-action");
    const body = document.getElementById("view-modal-body");
    body.innerHTML = [
      ["Student ID", s.StudentID],
      ["Last Name", s.LastName],
      ["First Name", s.FirstName],
      ["Middle Name", s.MiddleName || "-"],
      ["Gender", s.Gender],
      ["Date of Birth", s.DateOfBirth || "-"],
      ["Contact Number", s.ContactNumber || "-"],
      ["Address", s.Address || "-"],
      ["Section", this.sectionLabel(s.SectionID)],
      ["Status", s.Status || "Active"]
    ].map(([k, v]) => `<div class="view-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join("");
    Modal.open("modal-view");
  },

  editStudent() {
    const s = STATE.currentActionStudent;
    if (!s) return;
    Modal.close("modal-action");
    this.openStudentModal("edit", s);
  },

  openTransferModal() {
    const s = STATE.currentActionStudent;
    if (!s) return;
    Modal.close("modal-action");
    document.getElementById("transfer-current-section").textContent = this.sectionLabel(s.SectionID);
    const select = document.getElementById("transfer-new-section");
    select.innerHTML = STATE.sections
      .filter(sec => sec.SectionID !== s.SectionID)
      .map(sec => `<option value="${sec.SectionID}">${escapeHtml(sec.GradeLevel)} - ${escapeHtml(sec.SectionName)}</option>`)
      .join("");
    Modal.open("modal-transfer");
  },

  async confirmTransfer() {
    const s = STATE.currentActionStudent;
    const newSectionId = document.getElementById("transfer-new-section").value;
    if (!s || !newSectionId) { Toast.warning("Please select a section."); return; }
    const btn = document.getElementById("confirm-transfer-btn");
    Auth.setLoading(btn, true);
    try {
      await Api.call("transferStudent", { StudentID: s.StudentID, NewSectionID: newSectionId });
      // Update the student's section locally; a transfer updates the existing
      // record instead of creating a duplicate, so the student is
      // automatically removed from the old section's list and added to the
      // new one on next render.
      const idx = STATE.students.findIndex(st => st.StudentID === s.StudentID);
      if (idx !== -1) STATE.students[idx].SectionID = newSectionId;
      Store.set("students", STATE.students);
      Modal.close("modal-transfer");
      const newSec = STATE.sections.find(sec => sec.SectionID === newSectionId);
      Toast.success(`Student successfully transferred to ${newSec ? newSec.GradeLevel + "-" + newSec.SectionName : "new section"}.`);
      this.renderAll();
      if (STATE.currentSection) Sections.renderSectionModalTable();
    } catch (err) {
      Toast.error(err.message || "Unable to transfer student.");
    } finally {
      Auth.setLoading(btn, false);
    }
  },

  renderAll() {
    this.renderEnrollmentTable();
    Sections.render();
    Dashboard.render();
    Grading.populateStudentsIfSectionSelected();
  }
};

/* ================= 13. GRADING MODULE ================= */
const Grading = {
  init() {
    document.getElementById("grading-section-select").addEventListener("change", (e) => {
      this.loadSection(e.target.value);
    });
    document.getElementById("save-grades-btn").addEventListener("click", () => this.saveGrades());
  },
  get subjects() {
    return (STATE.settings.Subjects || "").split(",").map(s => s.trim()).filter(Boolean);
  },
  loadSection(sectionId) {
    const saveBtn = document.getElementById("save-grades-btn");
    const emptyEl = document.getElementById("grading-empty");
    if (!sectionId) {
      document.getElementById("grading-tbody").innerHTML = "";
      document.getElementById("grading-thead").innerHTML = "<tr><th>Student</th></tr>";
      emptyEl.hidden = false;
      emptyEl.textContent = "Select a school section to begin grading.";
      saveBtn.disabled = true;
      return;
    }
    STATE.currentGradingSectionId = sectionId;
    const students = sortStudents(STATE.students.filter(s => s.SectionID === sectionId), "LastName", "asc");
    const subjects = this.subjects;

    const thead = document.getElementById("grading-thead");
    thead.innerHTML = "<tr><th>Student</th>" + subjects.map(sub => `<th>${escapeHtml(sub)}</th>`).join("") + "<th>Average</th><th>Remarks</th></tr>";

    const tbody = document.getElementById("grading-tbody");
    tbody.innerHTML = "";
    emptyEl.hidden = students.length !== 0;
    if (students.length === 0) emptyEl.textContent = "No students in this section yet.";
    saveBtn.disabled = students.length === 0;

    students.forEach(s => {
      const tr = document.createElement("tr");
      tr.dataset.studentId = s.StudentID;
      const cells = subjects.map(sub => {
        const g = this.getGrade(s.StudentID, sub);
        return `<td><input type="number" min="0" max="100" class="grade-input" data-subject="${escapeHtml(sub)}" value="${g !== null && g !== undefined ? g : ""}" /></td>`;
      }).join("");
      tr.innerHTML = `<td>${escapeHtml(s.LastName)}, ${escapeHtml(s.FirstName)}</td>${cells}<td class="avg-cell">-</td><td class="remarks-cell">-</td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("input.grade-input").forEach(input => {
      input.addEventListener("input", () => this.recalcRow(input.closest("tr")));
      this.recalcRow(document.querySelector(`tr[data-student-id="${CSS.escape(input.closest("tr").dataset.studentId)}"]`));
    });
  },
  getGrade(studentId, subject) {
    const rec = STATE.grades.find(g => g.StudentID === studentId && g.Subject === subject && g.SectionID === STATE.currentGradingSectionId);
    return rec ? rec.Grade : null;
  },
  recalcRow(tr) {
    if (!tr) return;
    const inputs = [...tr.querySelectorAll("input.grade-input")];
    let sum = 0, count = 0, hasInvalid = false, hasEmpty = false;
    inputs.forEach(inp => {
      const val = inp.value.trim();
      if (val === "") { hasEmpty = true; inp.classList.remove("invalid"); return; }
      const num = Number(val);
      if (isNaN(num) || num < 0 || num > 100) {
        inp.classList.add("invalid");
        hasInvalid = true;
      } else {
        inp.classList.remove("invalid");
        sum += num; count++;
      }
    });
    const avgCell = tr.querySelector(".avg-cell");
    const remarksCell = tr.querySelector(".remarks-cell");
    if (hasInvalid) {
      avgCell.textContent = "-";
      remarksCell.innerHTML = `<span class="status-badge badge-danger">Invalid</span>`;
      return;
    }
    if (hasEmpty || count < inputs.length) {
      avgCell.textContent = "Pending";
      remarksCell.innerHTML = `<span class="status-badge badge-warning">Pending</span>`;
      return;
    }
    const avg = sum / inputs.length;
    avgCell.textContent = avg.toFixed(2);
    const passing = Number(STATE.settings.PassingGrade) || 75;
    const passed = avg >= passing;
    remarksCell.innerHTML = `<span class="status-badge ${passed ? "badge-success" : "badge-danger"}">${passed ? "Passed" : "Failed"}</span>`;
  },
  async saveGrades() {
    const sectionId = STATE.currentGradingSectionId;
    if (!sectionId) return;
    const rows = [...document.querySelectorAll("#grading-tbody tr")];
    const invalid = rows.some(tr => [...tr.querySelectorAll("input.grade-input")].some(i => i.classList.contains("invalid")));
    if (invalid) {
      Toast.error("Grade must be between 0 and 100.");
      return;
    }
    const btn = document.getElementById("save-grades-btn");
    Auth.setLoading ? null : null;
    btn.disabled = true;
    const records = [];
    rows.forEach(tr => {
      const studentId = tr.dataset.studentId;
      tr.querySelectorAll("input.grade-input").forEach(inp => {
        const val = inp.value.trim();
        if (val === "") return;
        records.push({ StudentID: studentId, SectionID: sectionId, Subject: inp.dataset.subject, Grade: Number(val) });
      });
    });
    try {
      await Api.call("saveGrades", { records });
      // Merge into local grade cache
      records.forEach(rec => {
        const idx = STATE.grades.findIndex(g => g.StudentID === rec.StudentID && g.Subject === rec.Subject && g.SectionID === rec.SectionID);
        if (idx !== -1) STATE.grades[idx].Grade = rec.Grade;
        else STATE.grades.push(rec);
      });
      Store.set("grades", STATE.grades);
      Dashboard.render();
      Toast.success("Grades saved successfully.");
    } catch (err) {
      Toast.error(err.message || "Unable to save grades.");
    } finally {
      btn.disabled = false;
    }
  },
  populateStudentsIfSectionSelected() {
    const sel = document.getElementById("grading-section-select");
    if (sel.value) this.loadSection(sel.value);
  }
};

/* ================= 14. SETTINGS MODULE ================= */
const SettingsModule = {
  init() {
    document.getElementById("save-settings-btn").addEventListener("click", this.save.bind(this));
  },
  renderForm() {
    document.getElementById("settings-system-title").value = STATE.settings.SystemTitle || "";
    document.getElementById("settings-school-name").value = STATE.settings.SchoolName || "";
    document.getElementById("settings-school-year").value = STATE.settings.SchoolYear || "";
    document.getElementById("settings-semester").value = STATE.settings.Semester || "1st";
    document.getElementById("settings-subjects").value = STATE.settings.Subjects || "";
    document.getElementById("settings-passing-grade").value = STATE.settings.PassingGrade || 75;
  },
  applyToUI() {
    const title = STATE.settings.SystemTitle || "School Enrollment Management System";
    document.title = title;
    document.getElementById("login-system-title").textContent = title;
    document.getElementById("sidebar-system-title").textContent = title;
  },
  async save() {
    const btn = document.getElementById("save-settings-btn");
    const payload = {
      SystemTitle: document.getElementById("settings-system-title").value.trim(),
      SchoolName: document.getElementById("settings-school-name").value.trim(),
      SchoolYear: document.getElementById("settings-school-year").value.trim(),
      Semester: document.getElementById("settings-semester").value,
      Subjects: document.getElementById("settings-subjects").value.trim(),
      PassingGrade: Number(document.getElementById("settings-passing-grade").value) || 75
    };
    Auth.setLoading(btn, true);
    try {
      const saved = await Api.call("updateSettings", payload);
      STATE.settings = { ...STATE.settings, ...saved };
      Store.set("settings", STATE.settings);
      this.applyToUI();
      Toast.success("Settings saved successfully.");
    } catch (err) {
      Toast.error(err.message || "Unable to save settings.");
    } finally {
      Auth.setLoading(btn, false);
    }
  }
};

/* ================= 15. PRIVACY POLICY MODULE ================= */
const PrivacyPolicy = {
  html() {
    return `
      <h3>What Information We Collect</h3>
      <p>This system collects student information (name, gender, date of birth, contact details, address, and school section) entered by school administrators, and basic login/session information (username and a session token) used to keep administrators signed in.</p>
      <h3>How Information Is Stored</h3>
      <p>Student, section, grade, and settings records are stored in a Google Sheets spreadsheet that acts as the system's database. Only the Google Apps Script backend communicates with that spreadsheet; the spreadsheet itself is never exposed directly to the browser.</p>
      <h3>Local Storage Usage</h3>
      <p>This application does not use browser cookies. Instead, it uses your browser's LocalStorage to keep a temporary cache of your session, students, sections, and grades so the interface loads quickly and can show recent data if the connection is briefly unavailable. LocalStorage is only a convenience cache — Google Sheets remains the permanent record, and cached data is replaced whenever newer server data is available.</p>
      <h3>Why Information Is Collected</h3>
      <p>Information is collected solely to operate core school functions: enrolling students, organizing them into sections, recording grades, and giving administrators an authenticated dashboard to manage this data.</p>
      <h3>Data Access</h3>
      <p>Access is limited to authenticated administrators of this system. The backend validates every request rather than trusting the browser alone.</p>
      <h3>Data Retention</h3>
      <p>Records remain in the Google Sheets database until an administrator edits or removes them. Historical grade records are not silently deleted when a student changes sections.</p>
      <h3>Security Precautions</h3>
      <p>Requests are validated on the server, Student IDs are checked for uniqueness, grade values are range-checked, and the frontend avoids storing plaintext credentials unnecessarily. No system can guarantee absolute security, and this project does not claim certification under any specific data-protection law.</p>
      <h3>Administrator Responsibilities</h3>
      <p>Administrators are responsible for keeping login credentials confidential and for entering accurate student data.</p>
    `;
  },
  init() {
    document.getElementById("privacy-policy-content").innerHTML = this.html();
    document.getElementById("privacy-modal-content").innerHTML = this.html();
    document.getElementById("open-privacy-from-login").addEventListener("click", () => Modal.open("modal-privacy"));
  }
};

/* ================= 16. POLLING MANAGER ================= */
const Polling = {
  start() {
    this.stop();
    STATE.pollTimer = setInterval(() => this.tick(), CONFIG.POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  },
  stop() {
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollTimer = null;
  },
  onVisibilityChange() {
    if (document.visibilityState === "visible") {
      Polling.tick();
    }
  },
  isUserTyping() {
    const active = document.activeElement;
    return active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
  },
  async tick() {
    if (document.visibilityState !== "visible") return;
    if (this.isUserTyping()) return; // don't interrupt the administrator while typing
    if (!STATE.session) return;
    try {
      const data = await Api.call("getSnapshot", {});
      Connection.setOnline(true);
      let changed = false;
      if (JSON.stringify(data.students) !== JSON.stringify(STATE.students)) {
        STATE.students = data.students; Store.set("students", data.students); changed = true;
      }
      if (JSON.stringify(data.sections) !== JSON.stringify(STATE.sections)) {
        STATE.sections = data.sections; Store.set("sections", data.sections); changed = true;
      }
      if (JSON.stringify(data.grades) !== JSON.stringify(STATE.grades)) {
        STATE.grades = data.grades; Store.set("grades", data.grades); changed = true;
      }
      if (changed) {
        App.renderAll();
      }
    } catch (err) {
      Connection.setOnline(false);
    }
  }
};

/* ================= 17. CONNECTION STATUS ================= */
const Connection = {
  setOnline(isOnline) {
    if (STATE.isOnline === isOnline) return;
    STATE.isOnline = isOnline;
    const el = document.getElementById("conn-status");
    if (isOnline) {
      el.textContent = "Online";
      el.className = "conn-status conn-online";
      Toast.info("Connection restored. Data synchronized.");
    } else {
      el.textContent = "Offline (cached)";
      el.className = "conn-status conn-offline";
      Toast.warning("Unable to connect to the server. Using cached data.");
    }
  }
};

/* ================= 18. APP BOOTSTRAP ================= */
const App = {
  showLogin() {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("app-shell").hidden = true;
  },
  async enterApp() {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app-shell").hidden = false;

    // Load from cache immediately for instant UI, then refresh from server.
    STATE.students = Store.get("students", []);
    STATE.sections = Store.get("sections", []);
    STATE.grades = Store.get("grades", []);
    STATE.settings = Store.get("settings", STATE.settings);
    this.renderAll();
    SettingsModule.applyToUI();

    try {
      const data = await Api.call("getSnapshot", {});
      STATE.students = data.students || [];
      STATE.sections = data.sections || [];
      STATE.grades = data.grades || [];
      STATE.settings = data.settings || STATE.settings;
      Store.set("students", STATE.students);
      Store.set("sections", STATE.sections);
      Store.set("grades", STATE.grades);
      Store.set("settings", STATE.settings);
      Connection.setOnline(true);
      this.renderAll();
      SettingsModule.applyToUI();
    } catch (err) {
      Connection.setOnline(false);
      Toast.warning("Unable to connect to the server. Using cached data.");
    }

    Polling.start();
  },
  renderAll() {
    Sections.render();
    Students.renderEnrollmentTable();
    Dashboard.render();
    SettingsModule.renderForm();
    Grading.populateStudentsIfSectionSelected();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  Nav.init();
  Sections.init();
  Students.init();
  Grading.init();
  SettingsModule.init();
  PrivacyPolicy.init();
  Auth.init();
});
