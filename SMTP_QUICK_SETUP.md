# SMTP Quick Setup Guide

## Quick Steps to Enable Email OTP

### 1. Get Gmail App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Enable 2-Step Verification if not already enabled
3. Generate App Password:
   - Select **Mail**
   - Select **Other (Custom name)**
   - Name: "KodingCaravan Backend"
   - Click **Generate**
   - **Copy the 16-character password** (looks like: `abcd efgh ijkl mnop`)

### 2. Update .env File

In `kc-backend/.env`, add or update:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=kodingcaravan@gmail.com
SMTP_PASS=your-16-character-app-password-here
SMTP_FROM=info@kodingcaravan.com
SMTP_DISABLE=false
```

**Important**: Replace `your-16-character-app-password-here` with the App Password you generated (remove spaces).

### 3. Restart Services

After updating `.env`, restart your backend services:

```bash
# Stop services (Ctrl+C)
# Start services again
npm run dev
# or
pnpm dev
```

### 4. Test Email Sending

Try registering a new user or resending an OTP. Check:
- Console logs for email status
- The recipient's inbox (and spam folder)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid login" | Check App Password is correct (no spaces) |
| "SMTP disabled" | Set `SMTP_DISABLE=false` in `.env` |
| Email not received | Check spam folder, verify recipient email |
| Connection timeout | Check firewall, try port 465 with `SMTP_SECURE=true` |

## Full Documentation

See `NODEMAILER_GMAIL_SETUP.md` for complete documentation.
