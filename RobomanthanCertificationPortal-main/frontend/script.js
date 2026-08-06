// Single place to configure the backend URL.
// Locally it auto-detects localhost; once deployed, replace the
// production value below with your real backend URL (e.g. Render).
const API_BASE_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
   : "https://robo-certificate.onrender.com"; // <-- change this after deploying the backend

if (window.location.pathname.includes("admin.html")) {
  if (localStorage.getItem("adminAccess") !== "true") {
    window.location.href = "index.html";
  }
}

function toggleMode() {
  document.body.classList.toggle("dark");
  let btn = document.getElementById("modeBtn");
  if (document.body.classList.contains("dark")) btn.innerText = "☀️ Light Mode";
  else btn.innerText = "🌙 Dark Mode";
}

async function verifyCertificate() {
  const id = document.getElementById("certificateId").value;

  const result = document.getElementById("result");

  if (!id) {
    result.innerHTML = `
      <p style="color:red">
        Please enter a certificate ID
      </p>
    `;

    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/certificate/${id}`);

    const data = await response.json();

    if (!response.ok) {
      result.innerHTML = `
        <div class="error">
          <h2>❌ Certificate Not Found</h2>
          <p>${data.message}</p>
        </div>
      `;

      return;
    }

    const pdfUrl = `${API_BASE_URL}/${data.file_url.replace(/\\/g, "/")}`;

    result.innerHTML = `
      <div class="success">

        <h2>✅ Certificate Verified</h2>

        <p>
          Certificate ID:
          <strong>${data.certificate_id}</strong>
        </p>

        <p>
          Uploaded At:
          ${new Date(data.uploaded_at).toLocaleString()}
        </p>

        <a href="${pdfUrl}" target="_blank">
          Open Certificate PDF
        </a>

        <br><br>

        <iframe
          src="${pdfUrl}"
          width="100%"
          height="700">
        </iframe>

      </div>
    `;
  } catch (err) {
    console.log(err);

    result.innerHTML = `
      <div class="error">
        <h2>❌ Server Error</h2>
      </div>
    `;
  }
}

function showSection() {
  const value = document.getElementById("useType").value;

  document.getElementById("addSection").style.display = "none";
  document.getElementById("bundleSection").style.display = "none";
  document.getElementById("editSection").style.display = "none";
  document.getElementById("deleteSection").style.display = "none";

  if (value === "add")
    document.getElementById("addSection").style.display = "block";

  if (value === "bundle")
    document.getElementById("bundleSection").style.display = "block";

  if (value === "edit")
    document.getElementById("editSection").style.display = "block";

  if (value === "delete")
    document.getElementById("deleteSection").style.display = "block";
}

// async function addCertificate() {
//   const certificateId = document.getElementById("certificateId").value;

//   const file = document.getElementById("certificateFile").files[0];

//   if (!certificateId || !file) {
//     alert("Please fill all fields");
//     return;
//   }

//   const formData = new FormData();

//   formData.append("certificateId", certificateId);

//   formData.append("certificate", file);

//   try {
//     const response = await fetch("${API_BASE_URL}/addCertificate", {
//       method: "POST",
//       body: formData,
//     });

//     const data = await response.json();

//     alert(data.message);
//   } catch (err) {
//     console.log(err);

//     alert("Error uploading certificate");
//   }
// }

async function searchCertificate() {
  const id = document.getElementById("editId").value;

  const resultDiv = document.getElementById("searchResult");

  try {
    const response = await fetch(`${API_BASE_URL}/certificate/${id}`);

    const data = await response.json();

    if (!response.ok) {
      resultDiv.innerHTML = `
        <p style="color:red">
          ${data.message}
        </p>
      `;

      return;
    }

    const pdfUrl = `${API_BASE_URL}/${data.file_url.replace(/\\/g, "/")}`;

    resultDiv.innerHTML = `
      <h3>Certificate Found</h3>

      <p>
        Certificate ID:
        ${data.certificate_id}
      </p>

      <a href="${pdfUrl}" target="_blank">
        Open PDF
      </a>

      <br><br>

      <iframe
        src="${pdfUrl}"
        width="100%"
        height="600">
      </iframe>
    `;
  } catch (err) {
    console.log(err);

    resultDiv.innerHTML = `
      <p style="color:red">
        Error searching certificate
      </p>
    `;
  }
}

async function updateCertificate() {
  const id = document.getElementById("editId").value;

  const file = document.getElementById("newCertificateFile").files[0];

  if (!id || !file) {
    alert("Please enter ID and select a file");
    return;
  }

  const formData = new FormData();

  formData.append("certificate", file);

  try {
    const response = await fetch(`${API_BASE_URL}/certificate/${id}`, {
      method: "PUT",
      body: formData,
    });

    const data = await response.json();

    alert(data.message);
  } catch (err) {
    console.log(err);

    alert("Error updating certificate");
  }
}

async function deleteCertificate() {
  const id = document.getElementById("deleteId").value;

  if (!id) {
    alert("Enter Certificate ID");
    return;
  }

  const confirmDelete = confirm(`Delete certificate ${id}?`);

  if (!confirmDelete) return;

  try {
    const response = await fetch(`${API_BASE_URL}/certificate/${id}`, {
      method: "DELETE",
    });

    const data = await response.json();

    alert(data.message);
  } catch (err) {
    console.log(err);

    alert("Error deleting certificate");
  }
}

async function openAdminLogin() {
  const password = prompt("Enter Admin Password");

  if (!password) return;

  try {
    console.log("Logging in via:", `${API_BASE_URL}/adminLogin`);

    const response = await fetch(`${API_BASE_URL}/adminLogin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    const result = await response.json();

    if (result.success) {
      localStorage.setItem("adminAccess", "true");

      window.location.href = "admin.html";
    } else {
      alert("Wrong Password");
    }
  } catch (err) {
    console.error("Admin login failed:", err);
    alert(
      "Could not reach the server. It may be waking up (Render free tier can take up to a minute) — please wait and try again. If this keeps happening, check the browser console for details.",
    );
  }
}

async function generateCertificate() {
  try {
    console.log("Generate button clicked");
    const certificateId = document.getElementById("certificateId").value;

    const recipientName = document.getElementById("recipientName").value;

    const collegeName = document.getElementById("collegeName").value;

    const programName = document.getElementById("programName").value;

    const role = document.getElementById("role").value;

    const department = document.getElementById("department").value;

    const startDate = document.getElementById("startDate").value;

    const endDate = document.getElementById("endDate").value;

    const issueDate = document.getElementById("issueDate").value;

    const certificateType = document.getElementById("certificateType").value;

    const customDescription =
      document.getElementById("customDescription").value;

    const useCustomDescription = document.getElementById(
      "useCustomDescription",
    ).value;

    const includeAuthorizedSign = document.getElementById(
      "includeAuthorizedSign",
    ).value;

    const secondSignatory = document.getElementById("secondSignatory").value;

    const includeSecondSign =
      document.getElementById("includeSecondSign").value;

    const otherSignatoryName =
      document.getElementById("otherSignatoryName").value;

    const otherSignatoryDesignation = document.getElementById(
      "otherSignatoryDesignation",
    ).value;

    const includeThirdSign = document.getElementById("includeThirdSign").value;

    const thirdSignatoryName =
      document.getElementById("thirdSignatoryName").value;

    const thirdSignatoryDesignation = document.getElementById(
      "thirdSignatoryDesignation",
    ).value;

    const includeFourthSign =
      document.getElementById("includeFourthSign").value;

    const fourthSignatoryName = document.getElementById(
      "fourthSignatoryName",
    ).value;

    const fourthSignatoryDesignation = document.getElementById(
      "fourthSignatoryDesignation",
    ).value;

    const logoFile = document.getElementById("organizationLogo").files[0];

    const formData = new FormData();

    formData.append("certificateId", certificateId);
    formData.append("recipientName", recipientName);
    formData.append("collegeName", collegeName);
    formData.append("programName", programName);
    formData.append("role", role);
    formData.append("department", department);
    formData.append("startDate", startDate);
    formData.append("endDate", endDate);
    formData.append("issueDate", issueDate);
    formData.append("certificateType", certificateType);
    formData.append("customDescription", customDescription);
    formData.append("useCustomDescription", useCustomDescription);
    formData.append("includeAuthorizedSign", includeAuthorizedSign);
    formData.append("secondSignatory", secondSignatory);
    formData.append("includeSecondSign", includeSecondSign);
    formData.append("otherSignatoryName", otherSignatoryName);
    formData.append("otherSignatoryDesignation", otherSignatoryDesignation);
    formData.append("includeThirdSign", includeThirdSign);
    formData.append("thirdSignatoryName", thirdSignatoryName);
    formData.append("thirdSignatoryDesignation", thirdSignatoryDesignation);
    formData.append("includeFourthSign", includeFourthSign);
    formData.append("fourthSignatoryName", fourthSignatoryName);
    formData.append("fourthSignatoryDesignation", fourthSignatoryDesignation);

    if (logoFile) {
      formData.append("organizationLogo", logoFile);
    }

    const response = await fetch(`${API_BASE_URL}/generateCertificate`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();
    console.log(result);

    const resultDiv = document.getElementById("generateResult");

    if (result.success && result.pdf) {
      const pdfUrl = `${API_BASE_URL}/generated-certificates/${result.pdf}`;

      if (resultDiv) {
        resultDiv.innerHTML = `
          <p>${result.message}</p>
          <a href="${pdfUrl}" download="${result.pdf}" target="_blank">
            <button type="button">⬇️ Download Certificate PDF</button>
          </a>
        `;
      } else {
        // Fallback if the container div isn't on the page for some reason
        window.open(pdfUrl, "_blank");
      }
    } else {
      alert(result.message);
    }
  } catch(err) {
    console.error(err);
    alert(err.message);
  }
}

const params = new URLSearchParams(window.location.search);

const qrCertificateId = params.get("id");

if (qrCertificateId) {
  const input = document.getElementById("certificateId");

  if (input) {
    input.value = qrCertificateId;
    verifyCertificate();
  }
}

function changeCertificateType() {
  const descriptionSection = document.getElementById("descriptionSection");
  const type = document.getElementById("certificateType").value;

  const collegeName = document.getElementById("collegeName");
  const programName = document.getElementById("programName");
  const role = document.getElementById("role");
  const department = document.getElementById("department");

  if (type === "internship") {
    descriptionSection.style.display = "none";
    collegeName.style.display = "block";
    department.style.display = "block";

    collegeName.placeholder = "College Name";
    programName.placeholder = "Program Name";
    role.placeholder = "Role";
    department.placeholder = "Department";
  } else if (type === "course") {
    collegeName.style.display = "block";
    department.style.display = "block";
    descriptionSection.style.display = "block";
    collegeName.placeholder = "College Name";
    programName.placeholder = "Course Name";
    role.placeholder = "Trainer";
    department.placeholder = "Course Domain";
  } else if (type === "hackathon") {
    collegeName.style.display = "block";
    department.style.display = "block";
    descriptionSection.style.display = "block";
    collegeName.placeholder = "College Name";
    programName.placeholder = "Hackathon Name";
    role.placeholder = "Team Name";
    department.placeholder = "Team Rank";
  } else if (type === "fulltime") {
    collegeName.style.display = "block";
    department.style.display = "none";
    descriptionSection.style.display = "none";
    collegeName.placeholder = "Designation";
    programName.placeholder = "Employee ID";
    role.placeholder = "Department";
  }
}

function toggleDescriptionBox() {
  const useCustom = document.getElementById("useCustomDescription").value;

  document.getElementById("customDescription").style.display =
    useCustom === "yes" ? "block" : "none";
}

function changeSecondSignatory() {
  const value = document.getElementById("secondSignatory").value;

  const div = document.getElementById("otherSignatoryFields");
  const includeDiv = document.getElementById("includeSecondSignContainer");

  if (value === "other") {
    div.style.display = "block";
    includeDiv.style.display = "none";
  } else {
    div.style.display = "none";
    includeDiv.style.display = "block";
  }
}

function changeThirdSignatory() {
  const value = document.getElementById("includeThirdSign").value;

  document.getElementById("thirdSignatoryFields").style.display =
    value === "yes" ? "block" : "none";
}

function changeFourthSignatory() {
  const value = document.getElementById("includeFourthSign").value;

  document.getElementById("fourthSignatoryFields").style.display =
    value === "yes" ? "block" : "none";
}

// ---------- Bundle Download ----------

function changeCertificateTypeBundle() {
  const descriptionSection = document.getElementById("descriptionSectionBundle");
  const type = document.getElementById("certificateTypeBundle").value;

  const collegeName = document.getElementById("collegeNameBundle");
  const programName = document.getElementById("programNameBundle");
  const role = document.getElementById("roleBundle");
  const department = document.getElementById("departmentBundle");

  if (type === "internship") {
    descriptionSection.style.display = "none";
    collegeName.placeholder = "College Name";
    programName.placeholder = "Program Name";
    role.placeholder = "Role";
    department.placeholder = "Department";
  } else if (type === "course") {
    descriptionSection.style.display = "block";
    collegeName.placeholder = "College Name";
    programName.placeholder = "Course Name";
    role.placeholder = "Trainer";
    department.placeholder = "Course Domain";
  } else if (type === "hackathon") {
    descriptionSection.style.display = "block";
    collegeName.placeholder = "College Name";
    programName.placeholder = "Hackathon Name";
    role.placeholder = "Team Name";
    department.placeholder = "Team Rank";
  } else if (type === "fulltime") {
    descriptionSection.style.display = "none";
    collegeName.placeholder = "Designation";
    programName.placeholder = "Employee ID";
    role.placeholder = "Department";
  }
}

function toggleDescriptionBoxBundle() {
  const useCustom = document.getElementById("useCustomDescriptionBundle").value;

  document.getElementById("customDescriptionBundle").style.display =
    useCustom === "yes" ? "block" : "none";
}

function changeSecondSignatoryBundle() {
  const value = document.getElementById("secondSignatoryBundle").value;

  const div = document.getElementById("otherSignatoryFieldsBundle");
  const includeDiv = document.getElementById("includeSecondSignContainerBundle");

  if (value === "other") {
    div.style.display = "block";
    includeDiv.style.display = "none";
  } else {
    div.style.display = "none";
    includeDiv.style.display = "block";
  }
}

function changeThirdSignatoryBundle() {
  const value = document.getElementById("includeThirdSignBundle").value;

  document.getElementById("thirdSignatoryFieldsBundle").style.display =
    value === "yes" ? "block" : "none";
}

function changeFourthSignatoryBundle() {
  const value = document.getElementById("includeFourthSignBundle").value;

  document.getElementById("fourthSignatoryFieldsBundle").style.display =
    value === "yes" ? "block" : "none";
}

// Parses the "Name, RM ID" textarea into [{ recipientName, certificateId }, ...]
function parseStudentsList(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(",");
      const recipientName = (parts[0] || "").trim();
      const certificateId = (parts.slice(1).join(",") || "").trim();
      return { recipientName, certificateId };
    });
}

async function generateBundleCertificates() {
  const resultDiv = document.getElementById("bundleResult");

  try {
    const studentsRaw = document.getElementById("studentsList").value;
    const students = parseStudentsList(studentsRaw);

    if (students.length === 0) {
      alert("Please enter at least one student (Name, RM ID) — one per line.");
      return;
    }

    const invalid = students.find((s) => !s.recipientName || !s.certificateId);
    if (invalid) {
      alert(
        `Every line needs both a name and an RM ID, separated by a comma.\nProblem line: "${invalid.recipientName}, ${invalid.certificateId}"`,
      );
      return;
    }

    const formData = new FormData();

    formData.append("collegeName", document.getElementById("collegeNameBundle").value);
    formData.append("programName", document.getElementById("programNameBundle").value);
    formData.append("role", document.getElementById("roleBundle").value);
    formData.append("department", document.getElementById("departmentBundle").value);
    formData.append("startDate", document.getElementById("startDateBundle").value);
    formData.append("endDate", document.getElementById("endDateBundle").value);
    formData.append("issueDate", document.getElementById("issueDateBundle").value);
    formData.append("certificateType", document.getElementById("certificateTypeBundle").value);
    formData.append("customDescription", document.getElementById("customDescriptionBundle").value);
    formData.append("useCustomDescription", document.getElementById("useCustomDescriptionBundle").value);
    formData.append("includeAuthorizedSign", document.getElementById("includeAuthorizedSignBundle").value);
    formData.append("secondSignatory", document.getElementById("secondSignatoryBundle").value);
    formData.append("includeSecondSign", document.getElementById("includeSecondSignBundle").value);
    formData.append("otherSignatoryName", document.getElementById("otherSignatoryNameBundle").value);
    formData.append("otherSignatoryDesignation", document.getElementById("otherSignatoryDesignationBundle").value);
    formData.append("includeThirdSign", document.getElementById("includeThirdSignBundle").value);
    formData.append("thirdSignatoryName", document.getElementById("thirdSignatoryNameBundle").value);
    formData.append("thirdSignatoryDesignation", document.getElementById("thirdSignatoryDesignationBundle").value);
    formData.append("includeFourthSign", document.getElementById("includeFourthSignBundle").value);
    formData.append("fourthSignatoryName", document.getElementById("fourthSignatoryNameBundle").value);
    formData.append("fourthSignatoryDesignation", document.getElementById("fourthSignatoryDesignationBundle").value);
    formData.append("students", JSON.stringify(students));

    const logoFile = document.getElementById("organizationLogoBundle").files[0];
    if (logoFile) {
      formData.append("organizationLogo", logoFile);
    }

    resultDiv.innerHTML = `<p>Generating ${students.length} certificates… this can take a little while.</p>`;

    const response = await fetch(`${API_BASE_URL}/generateBulkCertificates`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let message = "Failed to generate the bundle.";
      try {
        const err = await response.json();
        message = err.message || message;
      } catch (e) {}
      resultDiv.innerHTML = `<p style="color:red">${message}</p>`;
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificates_bundle_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    resultDiv.innerHTML = `<p>✅ Downloaded ${students.length} certificates as a zip.</p>`;
  } catch (err) {
    console.error(err);
    resultDiv.innerHTML = `<p style="color:red">Error generating bundle: ${err.message}</p>`;
  }
}
