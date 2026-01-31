# NodeMailer Gmail SMTP Setup Guide

This guide will help you configure NodeMailer to send OTP emails to users via Gmail SMTP.

## Prerequisites

- A Gmail account (kodingcaravan@gmail.com)
- Access to your Gmail account settings
- Environment variables configured in your `.env` file

## Step 1: Enable 2-Step Verification on Gmail

1. Go to your Google Account: https://myaccount.google.com/
2. Navigate to **Security** → **2-Step Verification**
3. Follow the prompts to enable 2-Step Verification (this is required to generate an App Password)

## Step 2: Generate Gmail App Password

1. After enabling 2-Step Verification, go to: https://myaccount.google.com/apppasswords
2. You may need to sign in again
3. Under **Select app**, choose **Mail**
4. Under **Select device**, choose **Other (Custom name)**
5. Enter a name like "KodingCaravan Backend" and click **Generate**
6. **Copy the 16-character password** that appears (you won't be able to see it again)
   - The password will look like: `abcd efgh ijkl mnop` (without spaces: `abcdefghijklmnop`)

## Step 3: Configure Environment Variables

Update your `.env` file in the `kc-backend` directory with the following SMTP configuration:

```env
# SMTP Configuration (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=kodingcaravan@gmail.com
SMTP_PASS=your-16-character-app-password-here
SMTP_FROM=info@kodingcaravan.com

# Enable SMTP for Trainer Auth Service (for development)
# Set to 'false' to enable emails, 'true' to disable
SMTP_DISABLE=false

# Email OTP Subject (optional)
EMAIL_OTP_SUBJECT=Verify your KodingCaravan account
```

### Important Notes:

- **SMTP_PASS**: Replace `your-16-character-app-password-here` with the App Password you generated in Step 2
- **SMTP_SECURE**: Set to `false` for port 587 (STARTTLS), `true` for port 465 (SSL)
- **SMTP_FROM**: This is the "From" address shown in emails. Gmail will still send from your authenticated account, but this appears as the sender name
- **SMTP_DISABLE**: For trainer-auth-service, set this to `false` to enable email sending in development mode

## Step 4: Verify Configuration

The mailer will automatically work once the environment variables are set. To verify:

1. Restart your backend services
2. Try registering a new user or resending an OTP
3. Check your console logs for email sending status
4. Check the recipient's inbox (and spam folder)

## How It Works

### Student Auth Service

The student auth service will automatically send OTP emails when:
- A student registers with email
- A student requests to resend OTP
- A student logs in with email (if email verification is required)

**Behavior:**
- If SMTP is not configured, OTP will be logged to console only
- If SMTP is configured, emails will be sent via Gmail SMTP

### Trainer Auth Service

The trainer auth service has additional logic:
- **Development mode**: Emails are disabled by default (SMTP_DISABLE auto-enabled)
- **Production mode**: Emails are enabled by default

To enable emails in development:
```env
SMTP_DISABLE=false
```

**Behavior:**
- OTP is always printed to console for debugging
- If SMTP_DISABLE=true, emails are skipped
- If SMTP is not configured, only console logging occurs
- If SMTP is configured and enabled, emails are sent

## Testing Email Sending

### Test Student Registration

1. Make a POST request to: `/api/v1/student-auth/register/email`
2. Body:
```json
{
  "email": "test@example.com",
  "password": "testpassword123"
}
```
3. Check the email inbox for the OTP code
4. Check console logs for email status

### Test Trainer Registration

1. Make a POST request to: `/api/v1/trainer-auth/register/email`
2. Body:
```json
{
  "email": "trainer@example.com",
  "password": "testpassword123",
  "username": "trainer123"
}
```
3. Check the email inbox for the OTP code
4. Check console logs for OTP (always printed)

## Troubleshooting

### "Invalid login" or "Authentication failed"

- **Issue**: App Password is incorrect or not set
- **Solution**: 
  - Verify you copied the App Password correctly (no spaces)
  - Make sure 2-Step Verification is enabled
  - Generate a new App Password if needed

### "Connection timeout" or "ECONNREFUSED"

- **Issue**: Firewall or network blocking SMTP port
- **Solution**: 
  - Check if port 587 is accessible
  - Try port 465 with SMTP_SECURE=true
  - Check firewall settings

### "Email not received"

- **Issue**: Email sent but not delivered
- **Solution**:
  - Check spam/junk folder
  - Verify recipient email address is correct
  - Check console logs for errors
  - Verify SMTP configuration is correct

### "SMTP disabled" message (Trainer Auth Service)

- **Issue**: SMTP_DISABLE is set to true or in development mode
- **Solution**: 
  - Set `SMTP_DISABLE=false` in your `.env` file
  - Restart the trainer-auth-service

### Emails not sending in development

- **Issue**: SMTP credentials not loaded
- **Solution**:
  - Make sure `.env` file is in the `kc-backend` directory
  - Verify all SMTP variables are set (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
  - Restart all services after changing `.env`
  - Check that environment variables are being loaded correctly

## Gmail Sending Limits

Be aware of Gmail's sending limits:
- **Free Gmail accounts**: 500 emails per day
- **Google Workspace**: 2000 emails per day (depending on plan)

For production, consider:
- Using a dedicated email service (SendGrid, Mailgun, AWS SES)
- Using a Google Workspace account
- Implementing rate limiting

## Alternative SMTP Providers

If you want to use a different email provider, update the SMTP settings:

### SendGrid
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

### Mailgun
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@your-domain.mailgun.org
SMTP_PASS=your-mailgun-password
```

### AWS SES
```env
SMTP_HOST=email-smtp.region.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-aws-ses-smtp-username
SMTP_PASS=your-aws-ses-smtp-password
```

## Security Best Practices

1. **Never commit `.env` files** to version control
2. **Use App Passwords** instead of your main Gmail password
3. **Rotate App Passwords** periodically
4. **Use environment variables** in production (not hardcoded values)
5. **Enable 2FA** on your Gmail account
6. **Monitor email sending** to detect abuse
7. **Use dedicated email services** for production (not personal Gmail)

## Next Steps

After configuring SMTP:

1. Test email sending with a test account
2. Monitor email delivery rates
3. Set up email templates (optional enhancement)
4. Configure email logging/monitoring
5. Consider implementing email verification for production
