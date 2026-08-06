const express = require("express");
const app = express();
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();
const multer = require("multer");
const QRCode = require("qrcode");
const archiver = require("archiver");

// This is what gets baked into every certificate's QR code, so it MUST be
// a URL your phone (on any network) can actually reach — not localhost.
// Set FRONTEND_URL in your .env to wherever verify.html is really hosted,
// e.g. FRONTEND_URL=https://your-frontend.onrender.com or your GitHub
// Pages / Netlify / Vercel URL. Falls back to localhost only for local
// testing on the same machine.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500/frontend";
app.use("/uploads", express.static("uploads"));
app.use("/generated-certificates", express.static("generated-certificates"));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Prevent an idle-client network error (e.g. Neon auto-suspend / cold start)
// from crashing the whole server.
pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

// Wrap pool.query so every existing call site automatically gets a retry
// on transient connection drops (common right after Neon wakes from
// auto-suspend), without having to change every query in this file.
const rawPoolQuery = pool.query.bind(pool);
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "57P01", // admin_shutdown
]);

pool.query = async (text, params) => {
  const maxAttempts = 3;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await rawPoolQuery(text, params);
    } catch (err) {
      lastErr = err;
      const isTransient =
        TRANSIENT_ERROR_CODES.has(err.code) ||
        TRANSIENT_ERROR_CODES.has(err.message);

      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }

      console.warn(
        `DB query failed (${err.code || err.message}), retrying attempt ${attempt + 1}/${maxAttempts}...`,
      );
      // small backoff so a still-waking Neon compute has time to come up
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastErr;
};

app.use(express.json());
app.use(cors());

const fs = require("fs");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const path = require("path");

function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(" ");

  let lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine === "" ? word : currentLine + " " + word;

    const width = font.widthOfTextAtSize(testLine, fontSize);

    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  lines.push(currentLine);

  return lines;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

app.get("/certificates", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM certificates");

    res.json(result.rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Server error",
    });
  }
});

app.get("/certificate/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      "SELECT * FROM certificates WHERE certificate_id=$1",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Certificate Not Found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Server Error",
    });
  }
});

app.put("/certificate/:id", upload.single("certificate"), async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      "UPDATE certificates SET file_url=$1 WHERE certificate_id=$2 RETURNING *",
      [req.file.path, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Certificate not found",
      });
    }

    res.json({
      message: "Certificate updated successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Server Error",
    });
  }
});
app.post("/addCertificate", upload.single("certificate"), async (req, res) => {
  try {
    
    const certificateId = req.body.certificateId;

    const filePath = req.file.path;

    await pool.query(
      `INSERT INTO certificates
         (certificate_id, file_url)
         VALUES ($1,$2)`,
      [certificateId, filePath],
    );

    res.json({
      message: "Certificate added successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Server Error",
    });
  }
});

app.delete("/certificate/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      `DELETE FROM certificates
             WHERE certificate_id = $1
             RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Certificate not found",
      });
    }

    res.json({
      message: "Certificate deleted successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Server Error",
    });
  }
});
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.post("/adminLogin", (req, res) => {
  const password = req.body.password;

  if (password === process.env.ADMIN_PASSWORD) {
    return res.json({
      success: true,
    });
  }

  return res.json({
    success: false,
  });
});

const signMap = {
  CMO: {
    image: "Sukumar_Sir.png",
    lines: ["Mr. Sukumar G", "CMO, Robomanthan"],
  },
};

const LOGO = {
  x: 700,
  y: 470,
  width: 90,
  height: 90,
};

// Builds a single certificate PDF and persists it (DB row + file on disk).
// `fields` is the same shape as req.body for /generateCertificate.
// `logoFile` is the same shape as req.file (multer) — pass null if none.
// Returns { pdfBytes, pdfFileName, certificateId } instead of sending a response,
// so it can be reused by both the single-certificate route and the bulk route.
async function buildCertificatePdf(fields, logoFile) {
      const {
        certificateId,
        recipientName,
        collegeName,
        programName,
        role,
        department,
        startDate,
        endDate,
        issueDate,
        certificateType,
        customDescription,
        useCustomDescription,
        includeAuthorizedSign,
        secondSignatory,
        includeSecondSign,
        otherSignatoryName,
        otherSignatoryDesignation,
        includeThirdSign,
        thirdSignatoryName,
        thirdSignatoryDesignation,
        includeFourthSign,
        fourthSignatoryName,
        fourthSignatoryDesignation,
      } = fields;

      

      const defaultDescriptions = {
        course:
          "The learner successfully completed the course requirements and demonstrated commitment, technical understanding, practical skills, and continuous learning throughout the program.",

        hackathon:
          "The participant demonstrated innovation, creativity, teamwork, problem-solving ability, technical expertise, and dedication throughout the hackathon event.",
      };

      let descriptionText = "";

      if (certificateType === "course" || certificateType === "hackathon") {
        if (useCustomDescription === "yes" && customDescription.trim() !== "") {
          descriptionText = customDescription;
        } else {
          descriptionText = defaultDescriptions[certificateType];
        }
      }

      

      await pool.query(
        `
    INSERT INTO certificates
    (
      certificate_id,
      recipient_name,
      college_name,
      program_name,
      role,
      department,
      start_date,
      end_date,
      issue_date,
      certificate_type
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
        [
          certificateId,
          recipientName,
          collegeName,
          programName,
          role,
          department,
          startDate,
          endDate,
          issueDate,
          certificateType,
        ],
      );
      
      const pdfDoc = await PDFDocument.create();
      
      let organizationLogoImage = null;

      if (logoFile) {
        const logoBytes = fs.readFileSync(logoFile.path);

        if (logoFile.mimetype === "image/png") {
          organizationLogoImage = await pdfDoc.embedPng(logoBytes);
        } else {
          organizationLogoImage = await pdfDoc.embedJpg(logoBytes);
        }
      }

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const page = pdfDoc.addPage([842, 595]);
      const totalSigns =
        2 +
        (includeThirdSign === "yes" ? 1 : 0) +
        (includeFourthSign === "yes" ? 1 : 0);

      let templateFile;

      if (certificateType === "internship") {
        if (totalSigns === 2) templateFile = "2intern.png";
        else if (totalSigns === 3) templateFile = "intern3.png";
        else templateFile = "intern4.png";
      } else if (certificateType === "course") {
        if (totalSigns === 2) templateFile = "2course.png";
        else if (totalSigns === 3) templateFile = "course3.png";
        else templateFile = "course4.png";
      } else if (certificateType === "hackathon") {
        if (totalSigns === 2) templateFile = "2hack.png";
        else if (totalSigns === 3) templateFile = "hack3.png";
        else templateFile = "hack4.png";
      } else if (certificateType === "fulltime") {
        if (totalSigns === 2) templateFile = "2exp.png";
        else if (totalSigns === 3) templateFile = "exp3.png";
        else templateFile = "exp4.png";
      }

      let secondSignLines = [];
      if (secondSignatory === "CMO") {
        secondSignLines = signMap.CMO.lines;
      } else {
        secondSignLines = [otherSignatoryName, otherSignatoryDesignation];
      }

      

      const imageBytes = fs.readFileSync(
        path.join(__dirname, "templates", templateFile),
      );

      const image = await pdfDoc.embedPng(imageBytes);

      page.drawImage(image, {
        x: 0,
        y: 0,
        width: 842,
        height: 595,
      });

      

      if (organizationLogoImage) {
        

        page.drawImage(organizationLogoImage, LOGO);
      }

      
      const verifyUrl = `${FRONTEND_URL}/verify.html?id=${certificateId}`;

      const qrImageBytes = await QRCode.toBuffer(verifyUrl);

      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      let authorizedSignImage;

      if (includeAuthorizedSign === "yes") {
        const signBytes = fs.readFileSync(
          path.join(__dirname, "signatures", "Saurav_Sir.png"),
        );
        
        authorizedSignImage = await pdfDoc.embedPng(signBytes);
      }

      let secondSignImage;

      if (secondSignatory === "CMO" && includeSecondSign === "yes") {
        const signBytes = fs.readFileSync(
          path.join(__dirname, "signatures", signMap.CMO.image),
        );
        
        secondSignImage = await pdfDoc.embedPng(signBytes);
      }

      if (certificateType === "internship") {
        if (totalSigns>=3) {
          //
          page.drawText(recipientName, {
            x: 300,
            y: 360,
            size: 35,
          });

          page.drawText(collegeName, {
            x: 440,
            y: 316,
            size: 17,
          });

          const maxWidth = 200;
          const centerX = 421; // half of 842 page width

          let fontSize = 17;

          // Auto shrink if text is too long
          while (
            font.widthOfTextAtSize(programName, fontSize) > maxWidth &&
            fontSize > 10
          ) {
            fontSize--;
          }

          const textWidth = font.widthOfTextAtSize(programName, fontSize);

          // Auto center
          page.drawText(programName, {
            x: centerX - textWidth / 2 + 20,
            y: 293,
            size: fontSize,
            font,
          });

          page.drawText(startDate, {
            x: 370,
            y: 252,
            size: 14,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 252,
            size: 14,
            color: rgb(1, 1, 1),
          });

          page.drawText(certificateId, {
            x: 140,
            y: 259,
            size: 13,
          });

          page.drawText(issueDate, {
            x: 140,
            y: 227,
            size: 13,
          });

          page.drawText(department, {
            x: 140,
            y: 198,
            size: 13,
          });

          page.drawText(role, {
            x: 140,
            y: 173,
            size: 13,
          });
          page.drawImage(qrImage, {
            x: 705,
            y: 320,
            width: 90,
            height: 90,
          });
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 78,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 66,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 90,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 78,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 66,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 90,
              width: 90,
              height: 40,
            });
          }
          if (includeThirdSign === "yes") {
            page.drawText(thirdSignatoryName, {
              x: 70,
              y: 78,
              size: 11,
            });
            page.drawText(thirdSignatoryDesignation, {
              x: 70,
              y: 66,
              size: 11,
            });
          }
          if (includeFourthSign === "yes") {
            page.drawText(fourthSignatoryName, {
              x: 630,
              y: 78,
              size: 11,
            });
            page.drawText(fourthSignatoryDesignation, {
              x: 630,
              y: 66,
              size: 11,
            });
          }
        } else {
          page.drawText(recipientName, {
            x: 300,
            y: 360,
            size: 35,
          });

          page.drawText(collegeName, {
            x: 440,
            y: 316,
            size: 17,
          });

          const maxWidth = 200;
          const centerX = 421; // half of 842 page width

          let fontSize = 17;

          // Auto shrink if text is too long
          while (
            font.widthOfTextAtSize(programName, fontSize) > maxWidth &&
            fontSize > 10
          ) {
            fontSize--;
          }

          const textWidth = font.widthOfTextAtSize(programName, fontSize);

          // Auto center
          page.drawText(programName, {
            x: centerX - textWidth / 2 + 20,
            y: 293,
            size: fontSize,
            font,
          });

          page.drawText(startDate, {
            x: 370,
            y: 252,
            size: 14,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 252,
            size: 14,
            color: rgb(1, 1, 1),
          });

          page.drawText(certificateId, {
            x: 170,
            y: 172,
            size: 13,
          });

          page.drawText(issueDate, {
            x: 170,
            y: 145,
            size: 13,
          });

          page.drawText(department, {
            x: 170,
            y: 119,
            size: 13,
          });

          page.drawText(role, {
            x: 170,
            y: 93,
            size: 13,
          });
          page.drawImage(qrImage, {
            x: 670,
            y: 95,
            width: 90,
            height: 90,
          });
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 78,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 66,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 90,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 78,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 66,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 90,
              width: 90,
              height: 40,
            });
          }
        }
      } else if (certificateType === "course") {
        // COURSE COORDINATES HERE
        if (totalSigns>=3) {
          //
          page.drawText(recipientName, {
            x: 300,
            y: 370,
            size: 33,
          });

          page.drawText(collegeName, {
            x: 475,
            y: 327,
            size: 17,
          });

          const maxWidth = 220;
          const centerX = 421;

          let fontSize = 16;

          while (
            font.widthOfTextAtSize(programName, fontSize) > maxWidth &&
            fontSize > 10
          ) {
            fontSize--;
          }

          const textWidth = font.widthOfTextAtSize(programName, fontSize);

          page.drawText("  " + programName, {
            x: centerX - textWidth / 2,
            y: 300,
            size: fontSize,
            font,
          });

          page.drawText(startDate, {
            x: 380,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(certificateId, {
            x: 160,
            y: 267,
            size: 12,
          });

          page.drawText(issueDate, {
            x: 160,
            y: 235,
            size: 12,
          });

          page.drawText(department, {
            x: 160,
            y: 205,
            size: 12,
          });

          page.drawText(role, {
            x: 160,
            y: 175,
            size: 12,
          });

          page.drawImage(qrImage, {
            x: 700,
            y: 320,
            width: 90,
            height: 90,
          });
          const lines = wrapText(
            descriptionText,
            460, // max width
            font,
            12,
          );

          let currentY = 230;

          for (const line of lines) {
            page.drawText(line, {
              x: 240,
              y: currentY,
              size: 12,
              font,
            });

            currentY -= 18;
          }
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 98,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 86,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 98,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 86,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          if (includeThirdSign === "yes") {
            page.drawText(thirdSignatoryName, {
              x: 70,
              y: 98,
              size: 11,
            });
            page.drawText(thirdSignatoryDesignation, {
              x: 70,
              y: 86,
              size: 11,
            });
          }
          if (includeFourthSign === "yes") {
            page.drawText(fourthSignatoryName, {
              x: 630,
              y: 98,
              size: 11,
            });
            page.drawText(fourthSignatoryDesignation, {
              x: 630,
              y: 86,
              size: 11,
            });
          }
        } else {
          //name
          page.drawText(recipientName, {
            x: 300,
            y: 370,
            size: 33,
          });

          page.drawText(collegeName, {
            x: 475,
            y: 327,
            size: 17,
          });

          const maxWidth = 220;
          const centerX = 421;

          let fontSize = 16;

          while (
            font.widthOfTextAtSize(programName, fontSize) > maxWidth &&
            fontSize > 10
          ) {
            fontSize--;
          }

          const textWidth = font.widthOfTextAtSize(programName, fontSize);

          page.drawText("  " + programName, {
            x: centerX - textWidth / 2,
            y: 300,
            size: fontSize,
            font,
          });

          page.drawText(startDate, {
            x: 380,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(certificateId, {
            x: 180,
            y: 175,
            size: 12,
          });

          page.drawText(issueDate, {
            x: 180,
            y: 149,
            size: 12,
          });

          page.drawText(department, {
            x: 180,
            y: 124,
            size: 12,
          });

          page.drawText(role, {
            x: 180,
            y: 99,
            size: 12,
          });

          page.drawImage(qrImage, {
            x: 665,
            y: 100,
            width: 90,
            height: 90,
          });
          const lines = wrapText(
            descriptionText,
            500, // max width
            font,
            12,
          );

          let currentY = 230;

          for (const line of lines) {
            page.drawText(line, {
              x: 190,
              y: currentY,
              size: 12,
              font,
            });

            currentY -= 18;
          }
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 98,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 86,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 98,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 86,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 110,
              width: 90,
              height: 40,
            });
          }
        }
      } else if (certificateType === "hackathon") {
        // HACKATHON COORDINATES HERE
        if (totalSigns>=3) {
          //
          page.drawText(recipientName, {
            x: 300,
            y: 370,
            size: 33,
          });

          page.drawText(collegeName, {
            x: 475,
            y: 327,
            size: 17,
          });

          const maxWidth = 220;
          const centerX = 421;
          // page.drawText("|", {
          //   x: centerX,
          //   y: 300,
          //   size: 20,
          //   font,
          // });
          let fontSize = 16;

          while (
            font.widthOfTextAtSize(programName, fontSize) > maxWidth &&
            fontSize > 10
          ) {
            fontSize--;
          }

          const textWidth = font.widthOfTextAtSize(programName, fontSize);

          

          page.drawText("  " + programName, {
            x: centerX - textWidth / 2,
            y: 300,
            size: fontSize,
            font,
          });

          page.drawText(startDate, {
            x: 380,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(certificateId, {
            x: 140,
            y: 270,
            size: 12,
          });

          page.drawText(issueDate, {
            x: 140,
            y: 243,
            size: 12,
          });

          page.drawText(department, {
            x: 140,
            y: 220,
            size: 12,
          });

          page.drawText(role, {
            x: 140,
            y: 192,
            size: 12,
          });

          page.drawImage(qrImage, {
            x: 700,
            y: 320,
            width: 90,
            height: 90,
          });
          const lines = wrapText(
            descriptionText,
            460, // max width
            font,
            12,
          );

          let currentY = 230;

          for (const line of lines) {
            page.drawText(line, {
              x: 220,
              y: currentY,
              size: 12,
              font,
            });

            currentY -= 18;
          }
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 98,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 86,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 98,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 86,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          if (includeThirdSign === "yes") {
            page.drawText(thirdSignatoryName, {
              x: 70,
              y: 98,
              size: 11,
            });
            page.drawText(thirdSignatoryDesignation, {
              x: 70,
              y: 86,
              size: 11,
            });
          }
          if (includeFourthSign === "yes") {
            page.drawText(fourthSignatoryName, {
              x: 630,
              y: 98,
              size: 11,
            });
            page.drawText(fourthSignatoryDesignation, {
              x: 630,
              y: 86,
              size: 11,
            });
          }
        } else {
          page.drawText(recipientName, {
            x: 300,
            y: 370,
            size: 33,
          });

          page.drawText(collegeName, {
            x: 475,
            y: 327,
            size: 17,
          });

          const maxWidth = 220;
          const centerX = 421;
          // page.drawText("|", {
          //   x: centerX,
          //   y: 300,
          //   size: 20,
          //   font,
          // });
          let fontSize = 16;

          while (
            font.widthOfTextAtSize(programName, fontSize) > maxWidth &&
            fontSize > 10
          ) {
            fontSize--;
          }

          const textWidth = font.widthOfTextAtSize(programName, fontSize);

          

          page.drawText("  " + programName, {
            x: centerX - textWidth / 2,
            y: 300,
            size: fontSize,
            font,
          });

          page.drawText(startDate, {
            x: 380,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(certificateId, {
            x: 180,
            y: 175,
            size: 12,
          });

          page.drawText(issueDate, {
            x: 180,
            y: 149,
            size: 12,
          });

          page.drawText(department, {
            x: 180,
            y: 124,
            size: 12,
          });

          page.drawText(role, {
            x: 180,
            y: 99,
            size: 12,
          });

          page.drawImage(qrImage, {
            x: 665,
            y: 100,
            width: 90,
            height: 90,
          });
          const lines = wrapText(
            descriptionText,
            500, // max width
            font,
            12,
          );

          let currentY = 230;

          for (const line of lines) {
            page.drawText(line, {
              x: 190,
              y: currentY,
              size: 12,
              font,
            });

            currentY -= 18;
          }
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 98,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 86,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 98,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 86,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 110,
              width: 90,
              height: 40,
            });
          }
        }
      } else if (certificateType === "fulltime") {
        if (totalSigns>=3) {
          //
          page.drawText(recipientName, {
            x: 300,
            y: 370,
            size: 33,
          });

          // Designation (Worked as)
          page.drawText(collegeName, {
            x: 465,
            y: 327,
            size: 17,
          });

          // REMOVE programName from center completely

          // Duration
          page.drawText(startDate, {
            x: 380,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          // Left panel

          // Certificate ID
          page.drawText(certificateId, {
            x: 150,
            y: 275,
            size: 12,
          });

          // Issue Date
          page.drawText(issueDate, {
            x: 150,
            y: 249,
            size: 12,
          });

          // Department
          page.drawText(role, {
            x: 150,
            y: 220,
            size: 12,
          });

          // Employee ID
          page.drawText(programName, {
            x: 150,
            y: 195,
            size: 12,
          });

          page.drawImage(qrImage, {
            x: 700,
            y: 320,
            width: 90,
            height: 90,
          });
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 98,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 86,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 98,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 86,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          if (includeThirdSign === "yes") {
            page.drawText(thirdSignatoryName, {
              x: 70,
              y: 98,
              size: 11,
            });
            page.drawText(thirdSignatoryDesignation, {
              x: 70,
              y: 86,
              size: 11,
            });
          }
          if (includeFourthSign === "yes") {
            page.drawText(fourthSignatoryName, {
              x: 630,
              y: 98,
              size: 11,
            });
            page.drawText(fourthSignatoryDesignation, {
              x: 630,
              y: 86,
              size: 11,
            });
          }
        } else {
          // Employee Name
          page.drawText(recipientName, {
            x: 300,
            y: 370,
            size: 33,
          });

          // Designation (Worked as)
          page.drawText(collegeName, {
            x: 465,
            y: 327,
            size: 17,
          });

          // REMOVE programName from center completely

          // Duration
          page.drawText(startDate, {
            x: 380,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          page.drawText(endDate, {
            x: 480,
            y: 260,
            size: 13,
            color: rgb(1, 1, 1),
          });

          // Left panel

          // Certificate ID
          page.drawText(certificateId, {
            x: 180,
            y: 175,
            size: 12,
          });

          // Issue Date
          page.drawText(issueDate, {
            x: 180,
            y: 149,
            size: 12,
          });

          // Department
          page.drawText(role, {
            x: 180,
            y: 124,
            size: 12,
          });

          // Employee ID
          page.drawText(programName, {
            x: 180,
            y: 99,
            size: 12,
          });

          page.drawImage(qrImage, {
            x: 665,
            y: 100,
            width: 90,
            height: 90,
          });
          //Name of first signatory
          page.drawText("Mr. Saurav Kumar", {
            x: 280,
            y: 98,
            size: 11,
          });
          //designation of first signatory
          page.drawText("CEO,Robomanthan", {
            x: 280,
            y: 86,
            size: 11,
          });
          if (authorizedSignImage) {
            page.drawImage(authorizedSignImage, {
              x: 275,
              y: 110,
              width: 90,
              height: 40,
            });
          }
          // Name of second signatory
          page.drawText(secondSignLines[0], {
            x: 470, // adjust
            y: 98,
            size: 11,
          });

          // Designation of second signatory
          page.drawText(secondSignLines[1], {
            x: 470, // same x
            y: 86,
            size: 11,
          });
          //signature image of second signatory
          if (secondSignImage) {
            page.drawImage(secondSignImage, {
              x: 465,
              y: 110,
              width: 90,
              height: 40,
            });
          }
        }
      }

      // const verifyUrl = `http://localhost:5500/frontend/verify.html?id=${certificateId}`;

      // const qrImageBytes = await QRCode.toBuffer(verifyUrl);

      // const qrImage = await pdfDoc.embedPng(qrImageBytes);

      // page.drawImage(qrImage, {
      //   x: 670,
      //   y: 95,
      //   width: 90,
      //   height: 90,
      // });

      const pdfBytes = await pdfDoc.save();

      const pdfFileName = `${certificateId}.pdf`;

      const pdfPath = path.join(
        __dirname,
        "generated-certificates",
        pdfFileName,
      );

      fs.writeFileSync(pdfPath, pdfBytes);
      
      await pool.query(
        `
  UPDATE certificates
  SET file_url = $1
  WHERE certificate_id = $2
  `,
        [`generated-certificates/${pdfFileName}`, certificateId],
      );

      return { pdfBytes, pdfFileName, certificateId };
}

// Single-certificate route — unchanged behaviour, now just a thin wrapper
// around buildCertificatePdf().
app.post(
  "/generateCertificate",
  upload.single("organizationLogo"),
  async (req, res) => {
    try {
      const result = await buildCertificatePdf(req.body, req.file);

      res.json({
        success: true,
        message: "Certificate generated successfully",
        pdf: result.pdfFileName,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// Bundle / bulk route — same fields as /generateCertificate, but
// `certificateId` and `recipientName` are supplied per-student via a
// "students" field: a JSON string like
// [{ "certificateId": "RM001", "recipientName": "Asha Rao" }, ...]
// Everything else (certificateType, dates, signatories, logo, etc.) is
// shared across every certificate in the batch. Streams back a .zip.
app.post(
  "/generateBulkCertificates",
  upload.single("organizationLogo"),
  async (req, res) => {
    let students;

    try {
      students = JSON.parse(req.body.students || "[]");
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid students list — could not parse JSON.",
      });
    }

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one student (name + certificate ID).",
      });
    }

    if (students.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Please generate at most 200 certificates per bundle.",
      });
    }

    try {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="certificates_bundle_${Date.now()}.zip"`,
      );

      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("error", (err) => {
        throw err;
      });

      archive.pipe(res);

      const failed = [];

      for (const student of students) {
        const certificateId = (student.certificateId || "").trim();
        const recipientName = (student.recipientName || "").trim();

        if (!certificateId || !recipientName) {
          failed.push(`(missing name or RM id) — skipped`);
          continue;
        }

        try {
          const fields = {
            ...req.body,
            certificateId,
            recipientName,
          };

          const result = await buildCertificatePdf(fields, req.file);

          archive.append(Buffer.from(result.pdfBytes), {
            name: `${result.certificateId}.pdf`,
          });
        } catch (err) {
          console.error(`Bulk generation failed for ${certificateId}:`, err);
          failed.push(`${certificateId} - ${recipientName}: ${err.message}`);
        }
      }

      if (failed.length > 0) {
        archive.append(failed.join("\n"), { name: "failed_certificates.txt" });
      }

      await archive.finalize();
    } catch (err) {
      console.error(err);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: err.message,
        });
      } else {
        res.end();
      }
    }
  },
);

app.get("/test-pdf", async (req, res) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]);
  page.drawText("HELLO ROBOMANTHAN", {
    x: 200,
    y: 300,
    size: 30,
  });
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync("./generated-certificates/test.pdf", pdfBytes);
  res.json({
    success: true,
  });
});

app.get("/test-template", async (req, res) => {
  try {
    const pdfDoc = await PDFDocument.create();

    const page = pdfDoc.addPage([842, 595]);

    const imageBytes = fs.readFileSync(
      path.join(__dirname, "templates", "final_internship_template.png"),
    );

    const image = await pdfDoc.embedPng(imageBytes);

    page.drawImage(image, {
      x: 0,
      y: 0,
      width: 842,
      height: 595,
    });

    const pdfBytes = await pdfDoc.save();

    fs.writeFileSync(
      path.join(__dirname, "generated-certificates", "template-test.pdf"),
      pdfBytes,
    );

    res.json({
      success: true,
      message: "Template PDF created",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});
