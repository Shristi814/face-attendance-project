const totalStudents = document.getElementById("totalStudents");
const attendanceRecords = document.getElementById("attendanceRecords");
const expressionRecords = document.getElementById("expressionRecords");
const studentsTableBody = document.getElementById("studentsTableBody");
const attendanceTableBody = document.getElementById("attendanceTableBody");
const reportStatus = document.getElementById("reportStatus");

loadReports();

async function loadReports() {
  try {
    const response = await fetch("/dashboard-data");

    if (!response.ok) {
      throw new Error("Failed to load reports data");
    }

    const data = await response.json();

    renderSummary(data.totals || {});
    renderStudents(data.registeredStudents || []);
    renderAttendance(data.attendanceHistory || []);

    reportStatus.textContent = "Reports loaded successfully";
    reportStatus.className = "registration-status success mt-3";
  } catch (error) {
    console.error("Report load error:", error);
    reportStatus.textContent = "Failed to load reports";
    reportStatus.className = "registration-status error mt-3";
  }
}

function renderSummary(totals) {
  totalStudents.textContent = totals.students || 0;
  attendanceRecords.textContent = totals.attendanceRecords || 0;
  expressionRecords.textContent = totals.expressionRecords || 0;
}

function renderStudents(students) {
  if (!students.length) {
    studentsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center">No registered students found</td>
      </tr>
    `;
    return;
  }

  studentsTableBody.innerHTML = students.map((student) => {
    const registeredOn = formatDate(student.createdAt);
    const latestExpression = student.latestExpression?.dominantExpression || "N/A";
    const studentId = student._id;
    const photoHtml = student.photo
      ? `<img src="${student.photo}" alt="${escapeHtml(student.name)}" class="student-photo">`
      : `<div class="student-photo-placeholder"><i class="fas fa-user"></i></div>`;

    return `
      <tr>
        <td>${photoHtml}</td>
        <td>${escapeHtml(student.name)}</td>
        <td>${registeredOn}</td>
        <td>${student.totalAttendance || 0}</td>
        <td>${escapeHtml(latestExpression)}</td>
        <td>
          <button class="btn-delete" onclick="deleteStudent('${studentId}', '${escapeHtml(student.name)}')">
            <i class="fas fa-trash"></i> Delete
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderAttendance(history) {
  if (!history.length) {
    attendanceTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center">No attendance history found</td>
      </tr>
    `;
    return;
  }

  attendanceTableBody.innerHTML = history.map((entry) => {
    const date = formatDate(entry.date);
    const confidence = typeof entry.confidence === "number"
      ? `${entry.confidence.toFixed(1)}%`
      : "N/A";

    return `
      <tr>
        <td>${escapeHtml(entry.name)}</td>
        <td>${date}</td>
        <td>${confidence}</td>
        <td>${escapeHtml(entry.dominantExpression || "N/A")}</td>
      </tr>
    `;
  }).join("");
}

function formatDate(input) {
  if (!input) return "N/A";

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleString();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function deleteStudent(studentId, studentName) {
  const confirmed = confirm(
    `Are you sure you want to delete ${studentName}? This will also remove all their attendance and expression records.`
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/students/${studentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Failed to delete student");
    }

    const data = await response.json();
    alert(data.message);
    loadReports();
  } catch (error) {
    console.error("Delete error:", error);
    alert(`Error deleting student: ${error.message}`);
  }
}
