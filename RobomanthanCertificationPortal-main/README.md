# Robomanthan Certificate Generation & Verification System

## Overview

The **Robomanthan Certificate Generation & Verification System** is a web-based application that automates certificate generation, management, and verification.

The system generates professional PDF certificates from customizable templates, embeds QR codes for authenticity verification, supports multiple certificate types, configurable signatories, and optional organization branding.

---

# Features

## Certificate Types

The system currently supports four certificate types:

- Internship Certificate
- Course Completion Certificate
- Hackathon Participation Certificate
- Full-Time / Experience Certificate

---

## Dynamic PDF Generation

Administrators can generate certificates by entering:

- Certificate ID
- Recipient Name
- College / Organization
- Program / Course / Internship / Employee ID
- Role
- Department
- Start Date
- End Date
- Issue Date
- Custom Description (where applicable)

Each certificate is generated dynamically using professionally designed templates.

---

## Smart Layout Engine

The certificate generator automatically handles:

- Dynamic recipient name placement
- Automatic program name shrinking
- Automatic description text wrapping
- Template-specific coordinate mapping
- Dynamic organization logo placement
- Adaptive layouts for different certificate types

---

## QR Code Verification

Every generated certificate contains a unique QR Code.

The QR Code redirects users to the verification portal where the certificate authenticity can be verified using its Certificate ID.

---

## Flexible Signature System

The application supports **2, 3, and 4 signatory layouts**.

### Authorized Signatory

- Optional
- Fixed CEO details
- Signature inserted automatically

### Second Signatory

Two modes are supported:

- CMO (automatic name, designation and signature)
- Other (custom name and designation)

### Third Signatory

- Optional
- Custom name
- Custom designation

### Fourth Signatory

- Optional
- Custom name
- Custom designation

The system automatically selects the appropriate certificate template depending on the number of signatories.

---

## Dynamic Organization Logo

Administrators can optionally upload an organization logo while generating certificates.

If uploaded, the logo replaces the default placeholder on the certificate automatically.

---

## Verification Portal

Certificates can be verified using:

- Certificate ID
- QR Code

The verification portal displays the stored certificate PDF after successful verification.

---

## Certificate Management

The Admin Portal allows administrators to:

- Generate Certificates
- Edit Certificates
- Delete Certificates
- Verify Certificates

---

# Project Structure

```
backend/
├── generated-certificates/
├── signatures/
├── templates/
├── uploads/
├── server.js
├── package.json
└── .env

frontend/
├── admin.html
├── index.html
├── verify.html
├── script.js
├── style.css
└── assets/
```

---

# Tech Stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript

### Backend

- Node.js
- Express.js

### Database

- PostgreSQL

### Libraries

- pdf-lib
- qrcode
- multer
- bcrypt
- jsonwebtoken (JWT)
- dotenv

---

# Workflow

1. Admin logs into the portal.
2. Selects certificate type.
3. Enters certificate details.
4. Chooses signatory configuration.
5. Optionally uploads an organization logo.
6. Backend selects the appropriate certificate template.
7. Dynamic text is positioned.
8. QR Code is generated.
9. Signature images are inserted.
10. Organization logo is added (if provided).
11. PDF certificate is generated.
12. Certificate details are stored in the database.
13. Generated certificate can later be verified using its Certificate ID or QR Code.

---

# Environment Variables

Create a `.env` file inside the backend directory.

```env
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
ADMIN_PASSWORD=
```

---

# Required Assets

The following folders are required for certificate generation and should remain in the project.

```
backend/templates/
backend/signatures/
```

These folders contain:

- Certificate Templates
- Signature Images

---

# Future Enhancements

- Bulk Certificate Generation using Excel
- Email Delivery
- Digital Signature Support
- Certificate Revocation
- Template Editor
- Multiple Organization Themes
- Improved Adaptive Text Fitting
- Cloud Storage Integration
- Admin Dashboard Analytics

---

# Author

**Vatsal Narain**

Developed during a Software Development Internship at **Robomanthan Private Limited** to automate certificate generation, management, and verification.