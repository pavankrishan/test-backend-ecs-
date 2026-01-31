import axios from 'axios';

export interface Msg91Config {
  authKey: string;
  sender: string;
  templateId?: string;
}

export interface SendSmsOptions {
  phone: string;
  message: string;
  templateId?: string;
}

export interface SendSmsResult {
  success: boolean;
  provider: 'msg91' | 'local';
  messageId?: string;
  error?: string;
  warning?: string;
}

export class Msg91Service {
  private config: Msg91Config | null = null;
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const authKey = process.env.MSG91_AUTH_KEY;
    const sender = process.env.MSG91_SENDER;
    const templateId = process.env.MSG91_TEMPLATE_ID;

    if (authKey && sender) {
      this.config = {
        authKey,
        sender,
        templateId: templateId || undefined,
      };
      this.isInitialized = true;
      console.log('✅ Msg91 service initialized');
    } else {
      console.warn('⚠️  Msg91 service not configured (MSG91_AUTH_KEY or MSG91_SENDER missing)');
      this.isInitialized = false;
    }
  }

  /**
   * Check if Msg91 service is initialized and ready
   */
  isReady(): boolean {
    return this.isInitialized && this.config !== null;
  }

  /**
   * Normalize phone number to Indian format (91XXXXXXXXXX)
   */
  private normalizePhone(phone: string): string {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // If it starts with 91, return as is
    if (cleaned.startsWith('91')) {
      return cleaned;
    }

    // If it starts with 0, remove the leading 0
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }

    // Add 91 prefix if not present
    if (!cleaned.startsWith('91')) {
      cleaned = `91${cleaned}`;
    }

    return cleaned;
  }

  /**
   * Send SMS using Msg91 API
   */
  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    const { phone, message, templateId } = options;

    // If not configured, log locally (development mode)
    if (!this.isReady()) {
      console.info(`[MSG91:DEV] SMS message for ${phone}: ${message}`);
      return {
        success: true,
        provider: 'local',
        warning: 'Msg91 not configured, logged locally',
      };
    }

    if (!this.config) {
      return {
        success: false,
        provider: 'local',
        error: 'Msg91 service not configured',
      };
    }

    try {
      const normalizedPhone = this.normalizePhone(phone);

      // Msg91 API v5 Flow endpoint
      const payload: any = {
        sender: this.config.sender,
        recipients: [
          {
            mobiles: normalizedPhone,
            message: message,
          },
        ],
      };

      // Add template_id if provided (for template-based messages)
      if (templateId || this.config.templateId) {
        payload.template_id = templateId || this.config.templateId;
      }

      const response = await axios.post(
        'https://api.msg91.com/api/v5/flow/',
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            authkey: this.config.authKey,
          },
          timeout: 10000, // 10 seconds timeout
        }
      );

      // Extract message ID from response if available
      const messageId =
        response.data?.request_id ||
        response.data?.messageId ||
        response.data?.id;

      if (process.env.NODE_ENV !== 'production') {
        console.info(`[MSG91:SUCCESS] SMS sent to ${phone} (${normalizedPhone})`);
      }

      return {
        success: true,
        provider: 'msg91',
        messageId: messageId?.toString(),
      };
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        'Unknown error';

      console.error('❌ Msg91 SMS send failed:', {
        phone,
        error: errorMessage,
        response: error?.response?.data,
      });

      // Return success with warning for non-critical errors
      // This allows the system to continue even if SMS fails
      return {
        success: true,
        provider: 'local',
        warning: `Msg91 send failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Send bulk SMS to multiple recipients
   */
  async sendBulkSms(
    recipients: Array<{ phone: string; message: string }>
  ): Promise<Array<SendSmsResult & { phone: string }>> {
    const results: Array<SendSmsResult & { phone: string }> = [];

    // Send SMS to each recipient
    // Note: Msg91 supports bulk sending, but we'll send individually for better error handling
    for (const recipient of recipients) {
      const result = await this.sendSms({
        phone: recipient.phone,
        message: recipient.message,
      });
      results.push({ ...result, phone: recipient.phone });
    }

    return results;
  }

  /**
   * Send OTP SMS (specialized method for OTP messages)
   */
  async sendOtp(phone: string, otpCode: string, message?: string): Promise<SendSmsResult> {
    const defaultMessage = `Your KodingCaravan verification code is ${otpCode}. It will expire in 10 minutes.`;
    const finalMessage = message || defaultMessage;

    return this.sendSms({
      phone,
      message: finalMessage,
      templateId: this.config?.templateId, // Use template if configured
    });
  }
}

